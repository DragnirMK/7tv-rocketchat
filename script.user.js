// ==UserScript==
// @name         7TV Emote Integration on RocketChat
// @namespace    http://tampermonkey.net/
// @version      2025-05-18
// @description  Find and replace text with proper 7TV Emote
// @author       Pierre V.
// @match        https://im.XXX.com/* Replace XXX with your domain name
// @icon         https://www.svgrepo.com/show/354287/rocket-chat-icon.svg
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const API_URL = "https://7tv.io/v3/gql";
    const EMOTE_REGEX = /^:([A-Z0-9_]+):$/i;
    const LOCAL_STORAGE_KEY = "rc_seventv_emote_cache";

    let messageObserver = null;
    let currentUrl = location.href;

    const emoteCache = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || "{}");

    function buildRequestBody(emoteName) {
        return JSON.stringify({
            operationName: "SearchEmotes",
            variables: {
                query: emoteName,
                limit: 1,
                page: 1,
                sort: { value: "popularity", order: "DESCENDING" },
                filter: {
                    category: "TOP",
                    exact_match: true,
                    case_sensitive: false,
                    ignore_tags: false,
                    zero_width: false,
                    animated: false,
                    aspect_ratio: ""
                }
            },
            query: `
                query SearchEmotes($query: String!, $page: Int, $sort: Sort, $limit: Int, $filter: EmoteSearchFilter) {
                  emotes(query: $query, page: $page, sort: $sort, limit: $limit, filter: $filter) {
                    items {
                      id
                      name
                      owner { username }
                      host {
                        url
                        files { name format width height }
                      }
                    }
                  }
                }`
        });
    }

    async function searchEmote(emoteName) {
        const key = emoteName.toLowerCase();

        if (emoteCache[key]) {
            return emoteCache[key];
        }

        try {
            const response = await fetch(API_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: buildRequestBody(emoteName)
            });

            const result = await response.json();
            const emote = result?.data?.emotes?.items?.[0];
            if (!emote) return undefined;

            const baseUrl = emote.host.url;
            const filename = emote.host.files.find(f => f.name === "2x.webp")?.name || emote.host.files[0].name;
            const emoteData = {
                name: emote.name,
                imageUrl: `${baseUrl}/${filename}`
            };

            emoteCache[key] = emoteData;
            localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(emoteCache));

            return emoteData;
        } catch (err) {
            console.error(`Failed to fetch emote "${emoteName}":`, err);
            return undefined;
        }
    }

    async function replaceWithEmotes(messageDiv) {
        const spans = messageDiv.querySelectorAll('span[role="img"][aria-label]');
        for (const span of spans) {
            const text = span.textContent.trim();
            const match = text.match(EMOTE_REGEX);
            if (!match) continue;

            const emoteName = match[1];
            const emote = await searchEmote(emoteName);
            if (!emote) continue;

            const newSpan = document.createElement("span");
            newSpan.className = `rcx-message__emoji emoji rcx-message__emoji--big`;
            newSpan.style.backgroundImage = `url("${emote.imageUrl}")`;
            newSpan.title = `:${emote.name}:`;
            newSpan.textContent = `:${emote.name}:`;
            span.replaceWith(newSpan);
        }
    }

    function setupMessageObserver(messagesList) {
        if (messageObserver) messageObserver.disconnect();

        messagesList.querySelectorAll("div.rcx-message").forEach(replaceWithEmotes);

        messageObserver = new MutationObserver(mutations => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType === Node.ELEMENT_NODE && node.classList.contains("rcx-message")) {
                        replaceWithEmotes(node);
                    }
                }
            }
        });

        messageObserver.observe(messagesList, { childList: true });
    }

    function runScript() {
        let messagesList;
        const observer = new MutationObserver(() => {
            if (location.href !== currentUrl || !messagesList) {
                currentUrl = location.href;
                messagesList = document.querySelector("ul.messages-list");
                if (!messagesList) return
                setupMessageObserver(messagesList);
            }
        });

        observer.observe(document.body, { childList: true, subtree: true });
    }

    runScript();
})();

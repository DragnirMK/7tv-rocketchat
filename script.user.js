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
    const EMOTE_REGEX = /^:([A-Z0-9_:]+):$/i;
    const LOCAL_STORAGE_KEY = "rc_seventv_emote_cache";
    const SEARCH_DEBOUNCE_MS = 300;

    let messagesObserver = null;
    let threadObserver = null;
    let currentUrl = location.href;
    let searchTimeout = null;
    let lastSearchQuery = "";

    const emoteCache = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || "{}");

    function buildRequestBody(query, limit = 1, exactMatch = true) {
        return JSON.stringify({
            operationName: "SearchEmotes",
            variables: {
                query: query,
                limit: limit,
                page: 1,
                sort: { value: "popularity", order: "DESCENDING" },
                filter: {
                    category: "TOP",
                    exact_match: exactMatch,
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

    const replaceWithEmotes = messageDiv => _replaceWithEmotes(messageDiv.querySelector('div[class="rcx-message-body"]'))
    const hasTagInParents = (div, tag) => div && (div.tagName === tag || hasTagInParents(div.parentNode, tag))

    async function _replaceWithEmotes(div) {
        if (!div || hasTagInParents(div, 'CODE')) return;
        if (div.nodeType === Node.ELEMENT_NODE && div.role === 'img') {
            const emote = createEmoteElement(await getEmoteFromContent(div.textContent.trim()));
            if (emote) div.replaceWith(emote);
        } else if (div.nodeType === Node.TEXT_NODE) {
            const data = await Promise.all(div.textContent.split(' ').map(async (text) => {
                const emote = await getEmoteFromContent(text);
                return { emote, content: createEmoteElement(emote) ?? text }
            }))
            if (data.some(({ emote }) => emote)) {
                div.replaceWith(...data.reduce((arr, {content}, i) => {
                    if (typeof content === 'string' && typeof arr[arr.length - 1] === 'string') arr[arr.length - 1] += ' ' + content;
                    else arr.push(content);
                    return arr;
                }, []));
            }
        } else {
            div.childNodes.forEach(_replaceWithEmotes);
        }
    }

    async function getEmoteFromContent(text) {
        const match = text.match(EMOTE_REGEX);
        if (!match) return;

        const emoteName = match[1];
        return await searchEmote(emoteName);
    }

    function createEmoteElement(emote) {
        if (!emote) return;
        // Using image version
        return createEmoteImage(emote);

        // Using span version
        // return createEmoteSpan(emote);
    }

    function createEmoteImage(emote) {
        const newImg = document.createElement("img");
        newImg.src = emote.imageUrl;
        newImg.title = `${emote.name}`;
        return newImg;
    }

    function createEmoteSpan(emote) {
        const newSpan = document.createElement("span");
        newSpan.className = `rcx-message__emoji emoji rcx-message__emoji--big`;
        newSpan.style.backgroundImage = `url("${emote.imageUrl}")`;
        newSpan.title = `${emote.name}`;
        newSpan.textContent = `:${emote.name}:`;
        return newSpan;
    }

    async function searchEmotes(query) {
        if (!query || query.length < 2) return [];

        try {
            const response = await fetch(API_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: buildRequestBody(query, 10, false)
            });

            const result = await response.json();
            return result?.data?.emotes?.items || [];
        } catch (err) {
            console.error(`Failed to fetch emotes for "${query}":`, err);
            return [];
        }
    }

    function createEmoteWrapper(emote) {
        const wrapper = document.createElement("div");
        wrapper.className = "rcx-option__wrapper";

        const column = document.createElement("div");
        column.className = "rcx-option__column";

        const img = document.createElement("img");
        const baseUrl = emote.host.url;
        const filename = emote.host.files.find(f => f.name === "2x.webp")?.name || emote.host.files[0].name;
        img.src = `${baseUrl}/${filename}`;
        img.style.width = "24px";
        img.style.height = "24px";
        img.className = "rcx-css-0";

        const content = document.createElement("div");
        content.className = "rcx-option__content";
        content.textContent = `:${emote.name}:`;

        column.appendChild(img);
        wrapper.appendChild(column);
        wrapper.appendChild(content);
        return wrapper;
    }

    function createEmoteListItem(textInput, emote, popup) {
        const li = document.createElement("li");
        li.tabIndex = "-1";
        li.className = "rcx-option";
        li.id = `popup-item-:${emote.name}:`;

        li.appendChild(createEmoteWrapper(emote));

        li.addEventListener("click", () => {
            const currentValue = textInput.value;
            const lastColonIndex = currentValue.lastIndexOf(":");
            if (lastColonIndex !== -1) {
                textInput.value = currentValue.substring(0, lastColonIndex + 1) + emote.name + ": ";
                textInput.dispatchEvent(new Event("input", { bubbles: true }));
                textInput.focus();
                popup.remove();
            }
        });

        return li;
    }

    function filterUniqueEmotes(emotes) {
        const seenNames = new Set();
        return emotes.filter(emote => {
            const lowerName = emote.name.toLowerCase();
            if (seenNames.has(lowerName)) return false;
            seenNames.add(lowerName);
            return true;
        });
    }

    function updateEmotePopup(textInput, query, thread = false) {
        if (searchTimeout) {
            clearTimeout(searchTimeout);
        }

        searchTimeout = setTimeout(async () => {
            if (query === lastSearchQuery) return;
            lastSearchQuery = query;

            let emotePopup;
            if (thread) {
                const contextualBar = document.querySelector('div[aria-labelledby="contextualbarTitle"]');
                if (!contextualBar) return;
                emotePopup = contextualBar.querySelector("footer div[role='menu']");
            } else {
                emotePopup = document.querySelector("footer div[role='menu']");
            }
            if (!emotePopup) return;

            const oldEmoteList = emotePopup.querySelector(".rcx-box--full:last-child");
            if (!oldEmoteList) return;

            const result = await searchEmotes(query);
            if (result.length === 0) return;

            const emotes = filterUniqueEmotes(result);

            const newEmoteList = document.createElement("div");
            newEmoteList.className = "rcx-box rcx-box--full";

            emotes.forEach(emote => {
                newEmoteList.appendChild(createEmoteListItem(textInput, emote, emotePopup));
            });

            oldEmoteList.replaceWith(newEmoteList);
        }, SEARCH_DEBOUNCE_MS);
    }

    function setupChatObserver(messagesList, observer) {
        messagesList.querySelectorAll("div.rcx-message").forEach(replaceWithEmotes);

        observer = new MutationObserver(mutations => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType === Node.ELEMENT_NODE && node.classList.contains("rcx-message")) {
                        replaceWithEmotes(node);
                    }
                }
            }
        });

        observer.observe(messagesList, { childList: true });
    }

    function setupMessagesObserver() {
        const messagesList = document.querySelector("ul.messages-list");
        if (!messagesList) return;
        if (messagesObserver) messagesObserver.disconnect();
        setupChatObserver(messagesList, messagesObserver);
        return messagesList;
    }

    function setupThreadObserver() {
        const threadList = document.querySelector("ul.thread");
        if (!threadList) return;
        if (threadObserver) threadObserver.disconnect();
        setupChatObserver(threadList, threadObserver);
        setupEmoteSearch(true);
        return threadList;
    }

    function setupEmoteSearch(thread = false) {
        let textInput;
        if (thread) {
            const contextualBar = document.querySelector('div[aria-labelledby="contextualbarTitle"]');
            if (!contextualBar) return;
            textInput = contextualBar.querySelector('.rc-message-box__textarea');
        } else {
            textInput = document.querySelector(".rc-message-box__textarea");
        }
        if (!textInput) return;

        textInput.addEventListener("input", (e) => {
            const value = e.target.value;
            const lastColonIndex = value.lastIndexOf(":");

            if (lastColonIndex !== -1) {
                const query = value.substring(lastColonIndex + 1);
                if (query.length >= 2) {
                    updateEmotePopup(textInput, query, thread);
                }
            }
        });
        return textInput
    }

    function runScript() {
        let messagesList;
        let threadList;
        let textInput;
        const observer = new MutationObserver(() => {
            if (location.href !== currentUrl) {
                currentUrl = location.href;
                messagesList = setupMessagesObserver();
                threadList = setupThreadObserver();
                textInput = setupEmoteSearch();
            }

            if (!messagesList) {
                messagesList = setupMessagesObserver();
            }

            if (!threadList) {
                threadList = setupThreadObserver();
            }

            if (!textInput) {
                textInput = setupEmoteSearch();
            }
        });

        observer.observe(document.body, { childList: true, subtree: true });
    }

    runScript();
})();

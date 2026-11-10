(() => {
    const repository = { owner: "piguyoverthere", name: "Strawberry-MC-wiki", branch: "main" };
    const pagePath = decodeURIComponent(location.pathname);
    const deploymentPath = pagePath.slice(0, pagePath.lastIndexOf("/") + 1);
    const currentPage = pagePath.split("/").pop() || "index.html";
    const pageFilePattern = /^(?:page|news)-[a-z0-9]+(?:-[a-z0-9]+)*\.html$/;
    const params = new URLSearchParams(location.search);
    const isNewPage = currentPage === "new-page.html";
    const newPageFile = isNewPage && pageFilePattern.test(params.get("file") || "") ? params.get("file") : null;
    const targetFile = newPageFile || currentPage;
    const isNewsArticle = Boolean(newPageFile && newPageFile.startsWith("news-"));
    const storageKey = `strawberry-wiki-draft:${newPageFile ? deploymentPath + newPageFile : pagePath}`;
    const bookmarkStorageKey = `strawberry-wiki-bookmarks:${deploymentPath}`;
    const localPagesStorageKey = `strawberry-wiki-local-pages:${deploymentPath}`;
    const tokenStorageKey = "strawberry-wiki-github-token";
    const authorStorageKey = "strawberry-wiki-author";
    const accountStorageKey = "strawberry-wiki-account";
    const roleStorageKey = "strawberry-wiki-role";
    const sharedTokenFile = "wiki-token.json";
    const legacyEditableSelector = "h1, h2, h3, h4, h5, h6, p, li, td, th, blockquote, figcaption, summary";
    const islandSelector = "form, button, input, select, textarea, iframe, video, audio, canvas, #bookmarked-pages-list, #news-list, #ideas-app, #discussions-app, #notifications-app, #documents-app, #archives-app, #todo-app, #all-pages-app, #bugs-app, #login-app, #admin-app";
    const allowedTags = new Set([
        "A", "ABBR", "B", "BLOCKQUOTE", "BR", "CAPTION", "CODE", "DEL", "DETAILS", "DIV", "EM", "FIGCAPTION",
        "FIGURE", "FOOTER", "H1", "H2", "H3", "H4", "H5", "H6", "HR", "I", "IMG", "INS", "KBD", "LI", "MARK",
        "OL", "P", "PRE", "S", "SECTION", "SMALL", "SPAN", "STRONG", "SUB", "SUMMARY", "SUP", "TABLE", "TBODY",
        "TD", "TFOOT", "TH", "THEAD", "TR", "U", "UL"
    ]);
    const removedTags = new Set([
        "SCRIPT", "STYLE", "TEMPLATE", "IFRAME", "OBJECT", "EMBED", "LINK", "META",
        "FORM", "INPUT", "BUTTON", "SELECT", "TEXTAREA", "VIDEO", "AUDIO", "CANVAS"
    ]);
    const allowedAttributes = {
        "*": ["class", "id", "title", "style", "aria-label"],
        A: ["href", "target", "rel"],
        IMG: ["src", "alt", "width", "height"],
        TD: ["colspan", "rowspan"],
        TH: ["colspan", "rowspan", "scope"],
        OL: ["start"],
        DETAILS: ["open"],
        DIV: ["data-pending-by", "data-pending-date", "data-original"]
    };
    const allowedStyles = ["color", "background-color", "text-align"];
    const fontClasses = ["roman", "consolas", "georgia", "comic"];
    let editing = false;
    let savedRange = null;

    // Let phones lay the page out at their own width instead of a zoomed-out desktop view.
    if (!document.querySelector('meta[name="viewport"]')) {
        const viewport = document.createElement("meta");
        viewport.name = "viewport";
        viewport.content = "width=device-width, initial-scale=1";
        document.head.append(viewport);
    }

    // Wrap the page body (everything between the header and the scripts) so it can be edited as one region.
    const header = document.querySelector(".site-header");
    const root = document.createElement("div");
    root.className = "wiki-content";
    const contentNodes = [];
    for (let node = header ? header.nextSibling : document.body.firstChild; node && node.nodeName !== "SCRIPT"; node = node.nextSibling) {
        contentNodes.push(node);
    }
    root.append(...contentNodes);
    if (header) {
        header.after(root);
    } else {
        document.body.prepend(root);
    }

    // Interactive widgets (search box, buttons, bookmark list) are kept as-is and are not editable.
    const islands = [...root.querySelectorAll(islandSelector)].filter((element) =>
        !element.parentElement.closest(islandSelector) && !element.closest(".wiki-raw-html")
    );
    const islandMarkup = islands.map((element) => element.outerHTML);
    islands.forEach((element, index) => {
        element.dataset.wikiIsland = String(index);
    });

    /**
     * Hashes a given string using SHA-256
     * @param {string} text - The input text to convert
     * @returns {Promise<string>} The hex-encoded SHA-256 hash
     */
    async function convertToSha256(text) {
        const msgBuffer = new TextEncoder().encode(text);                    
        const hashBuffer = await window.crypto.subtle.digest('SHA-256', msgBuffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));                     
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    function hashToBigInt(hashHex) {
        // Prefixing with '0x' tells JavaScript this is a hex string
        return BigInt("0x" + hashHex);
    }

    function isSafeUrl(value) {
        try {
            const { protocol } = new URL(value, document.baseURI);
            return ["http:", "https:", "mailto:", location.protocol].includes(protocol) && protocol !== "javascript:";
        } catch {
            return false;
        }
    }

    // Raw HTML blocks keep any tag a writer puts in, except anything that can run code: scripts, plugins,
    // event attributes (onclick…), javascript: links and framed documents written inline.
    const rawRemovedTags = new Set(["script", "object", "embed", "applet", "base", "meta", "template", "animate", "set", "handler", "listener"]);
    const rawUrlAttributes = new Set(["href", "xlink:href", "src", "action", "formaction", "data", "poster", "background", "lowsrc", "dynsrc", "ping", "codebase", "cite", "longdesc", "usemap", "manifest", "srcset"]);

    function cleanRawHtml(markup) {
        const inertDocument = document.implementation.createHTMLDocument("");
        const container = inertDocument.body;
        container.innerHTML = markup;
        for (const node of [...container.querySelectorAll("*")]) {
            if (!node.isConnected) {
                continue;
            }
            if (rawRemovedTags.has(node.localName.toLowerCase())) {
                node.remove();
                continue;
            }
            for (const { name, value } of [...node.attributes]) {
                const lower = name.toLowerCase();
                // Browsers ignore spaces and control characters inside "java script:"
                const url = value.replace(/[\u0000-\u0020]/g, "").toLowerCase();
                if (
                    lower.startsWith("on") || lower === "srcdoc" || lower === "contenteditable" || lower.startsWith("data-wiki") ||
                    /(?:java|vb|live)script:/.test(url) ||
                    (rawUrlAttributes.has(lower) && url.startsWith("data:") && !/^data:image\/(?:png|jpe?g|gif|webp|avif);/.test(url))
                ) {
                    node.removeAttribute(name);
                }
            }
            if (node.localName === "link" && /import|preload|prefetch/i.test(node.getAttribute("rel") || "")) {
                node.remove();
            }
        }
        return container.innerHTML;
    }

    function sanitizeMarkup(markup, { keepIslands = true } = {}) {
        const inertDocument = document.implementation.createHTMLDocument("");
        const container = inertDocument.body;
        container.innerHTML = markup;

        function clean(node) {
            for (const child of [...node.childNodes]) {
                if (child.nodeType !== Node.ELEMENT_NODE) {
                    if (child.nodeType !== Node.TEXT_NODE) {
                        child.remove();
                    }
                    continue;
                }

                if (child.hasAttribute("data-wiki-island")) {
                    const index = Number(child.getAttribute("data-wiki-island"));
                    if (keepIslands && Number.isInteger(index) && index >= 0 && index < islands.length) {
                        const placeholder = inertDocument.createElement("span");
                        placeholder.dataset.wikiIsland = String(index);
                        child.replaceWith(placeholder);
                    } else {
                        child.remove();
                    }
                    continue;
                }

                if (child.tagName === "DIV" && child.classList.contains("wiki-raw-html")) {
                    const block = inertDocument.createElement("div");
                    block.className = "wiki-raw-html";
                    block.innerHTML = cleanRawHtml(child.innerHTML);
                    child.replaceWith(block);
                    continue;
                }

                if (removedTags.has(child.tagName)) {
                    child.remove();
                    continue;
                }

                clean(child);
                if (!allowedTags.has(child.tagName)) {
                    child.replaceWith(...child.childNodes);
                    continue;
                }

                for (const { name, value } of [...child.attributes]) {
                    const allowed = allowedAttributes["*"].includes(name) || allowedAttributes[child.tagName]?.includes(name);
                    if (
                        !allowed ||
                        ((name === "href" || name === "src") && !isSafeUrl(value)) ||
                        (name === "target" && value !== "_blank") ||
                        ((name === "class" || name === "id") && !/^[\w\s-]*$/.test(value)) ||
                        (name === "data-original" && !/^[A-Za-z0-9+/=]*$/.test(value)) ||
                        (name === "data-pending-date" && !/^[\dT:.Z-]*$/.test(value))
                    ) {
                        child.removeAttribute(name);
                    } else if (name === "style") {
                        const kept = allowedStyles
                            .map((property) => [property, child.style.getPropertyValue(property)])
                            .filter(([, propertyValue]) => propertyValue && !/url\(|expression/i.test(propertyValue));
                        if (kept.length > 0) {
                            child.setAttribute("style", kept.map(([property, propertyValue]) => `${property}: ${propertyValue}`).join("; "));
                        } else {
                            child.removeAttribute("style");
                        }
                    }
                }
            }
        }

        clean(container);
        return container.innerHTML;
    }

    function serializeContent() {
        const template = document.createElement("template");
        template.innerHTML = sanitizeMarkup(root.innerHTML);
        // Comment highlights are drawn in the browser and never saved into the page.
        for (const mark of template.content.querySelectorAll("mark.wiki-annotation-mark")) {
            mark.replaceWith(...mark.childNodes);
        }
        // Typing over a code box's placeholder can drop its <code> wrapper, so put it back.
        for (const pre of template.content.querySelectorAll("pre.code-box")) {
            if (pre.childNodes.length !== 1 || pre.firstChild.nodeName !== "CODE") {
                const code = document.createElement("code");
                code.className = "consolas";
                code.append(...pre.childNodes);
                pre.append(code);
            }
        }
        return template.innerHTML;
    }

    function applyContent(markup) {
        root.innerHTML = markup;
        for (const placeholder of root.querySelectorAll("span[data-wiki-island]")) {
            placeholder.replaceWith(islands[Number(placeholder.dataset.wikiIsland)]);
        }
        document.dispatchEvent(new Event("wiki-content-changed"));
    }

    function applyLegacyDraft(draft) {
        const leaves = [...root.querySelectorAll(legacyEditableSelector)].filter((element) =>
            !element.closest("[data-wiki-island]") && !element.querySelector(legacyEditableSelector)
        );
        leaves.forEach((element, index) => {
            if (typeof draft[index] === "string") {
                element.innerHTML = sanitizeMarkup(draft[index], { keepIslands: false });
            }
        });
    }

    function readLocalPages() {
        try {
            const parsed = JSON.parse(localStorage.getItem(localPagesStorageKey) || "[]");
            return Array.isArray(parsed) ? parsed.filter((page) => page && typeof page.file === "string") : [];
        } catch {
            return [];
        }
    }

    function saveLocalPage(entry) {
        const existing = readLocalPages().find((page) => page.file === entry.file);
        const pages = readLocalPages().filter((page) => page.file !== entry.file);
        // Merge so later saves keep fields like the article author and summary.
        pages.push({ ...existing, ...entry });
        try {
            localStorage.setItem(localPagesStorageKey, JSON.stringify(pages));
        } catch {
            // Search for browser-only pages is a convenience; editing still works without it.
        }
    }

    function getCurrentTitle() {
        return root.querySelector("h1")?.textContent.trim() || document.title;
    }

    function getDraftPageHref(file, title) {
        return `new-page.html?${new URLSearchParams({ file, title })}`;
    }

    function todayString() {
        return new Date().toLocaleDateString("en-CA");
    }

    function formatNewsDate(date) {
        const parsed = new Date(`${date}T00:00:00`);
        return Number.isNaN(parsed.getTime())
            ? date
            : parsed.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    }

    if (newPageFile) {
        const title = params.get("title")?.trim() || newPageFile.replace(/^(?:page|news)-|\.html$/g, "").replace(/-/g, " ");
        const heading = root.querySelector("h1");
        if (heading) {
            heading.textContent = title;
        }
        document.title = `${title} | Strawberry MC`;

        if (isNewsArticle) {
            const article = readLocalPages().find((page) => page.file === newPageFile);
            const byline = document.createElement("p");
            byline.className = "news-byline";
            byline.textContent = `By ${article?.author || "Unknown author"} · ${formatNewsDate(article?.date || todayString())}`;
            (heading || root.firstElementChild)?.after(byline);
            const backLink = document.createElement("p");
            backLink.innerHTML = '<a href="news.html">← Back to News</a>';
            root.append(backLink);
        }
    }

    const originalContent = serializeContent();
    let savedContent = originalContent;

    // Page tools float in the corner while reading and join the formatting bar while editing.
    const toolbar = document.createElement("section");
    toolbar.className = "wiki-editor-toolbar";
    toolbar.setAttribute("aria-label", "Page editing tools");
    toolbar.innerHTML = `
        <button type="button" data-action="edit">Edit page</button>
        <button type="button" data-action="save" disabled>Save edits</button>
        <button type="button" data-action="cancel" disabled>Cancel</button>
        <button type="button" data-action="commit">Commit to GitHub</button>
        <details class="wiki-more-menu">
            <summary title="More page tools">More</summary>
            <div class="wiki-more-items">
                <button type="button" data-action="download">Download HTML</button>
                <button type="button" data-action="reset">Reset saved edits</button>
            </div>
        </details>
    `;
    document.body.append(toolbar);

    const moreMenu = toolbar.querySelector(".wiki-more-menu");
    moreMenu.addEventListener("click", (event) => {
        if (event.target.closest("button")) {
            moreMenu.open = false;
        }
    });
    document.addEventListener("click", (event) => {
        if (moreMenu.open && !moreMenu.contains(event.target)) {
            moreMenu.open = false;
        }
    });

    // Messages appear briefly under the header instead of pushing the page down.
    const status = document.createElement("div");
    status.className = "wiki-editor-status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    document.body.append(status);
    let statusTimer = null;
    new MutationObserver(() => {
        clearTimeout(statusTimer);
        status.classList.toggle("wiki-status-visible", status.textContent.trim() !== "");
        statusTimer = setTimeout(() => status.classList.remove("wiki-status-visible"), 8000);
    }).observe(status, { childList: true, characterData: true, subtree: true });

    // The menus replace the header's plain links in the browser only; saved pages keep the links as written.
    let originalNavMarkup = null;
    const navMenus = [
        ["Wiki", [["all-pages.html", "All Pages"], ["credits.html", "Credits"], ["page-bookmarked-pages.html", "Bookmarked Pages"], ["todo.html", "To Do"], ["bugs.html", "Bug Tracker"]]],
        ["Community", [["news.html", "News"], ["ideas.html", "Ideas"], ["discussions.html", "Threads &amp; Debates"], ["notifications.html", "Notifications"], ["archives.html", "Archives"]]]
    ];

    function buildNavMenu(label, links) {
        const menu = document.createElement("div");
        menu.className = "nav-menu";
        menu.dataset.wikiInjected = "";
        menu.innerHTML = `<button type="button" class="nav-menu-button" aria-haspopup="true" aria-expanded="false">${label} ▾</button>
            <div class="nav-menu-items">${links.map(([href, text]) => `<a href="${href}"${href === currentPage ? ' aria-current="page"' : ""}>${text}</a>`).join("")}</div>`;
        const button = menu.querySelector("button");
        button.addEventListener("click", () => {
            const open = !menu.classList.contains("nav-menu-open");
            closeNavMenus();
            menu.classList.toggle("nav-menu-open", open);
            button.setAttribute("aria-expanded", String(open));
        });
        return menu;
    }

    function closeNavMenus() {
        for (const menu of document.querySelectorAll(".nav-menu-open")) {
            menu.classList.remove("nav-menu-open");
            menu.querySelector("button").setAttribute("aria-expanded", "false");
        }
    }

    document.addEventListener("click", (event) => {
        if (!event.target.closest(".nav-menu")) closeNavMenus();
    });
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") closeNavMenus();
    });

    if (header) {
        const nav = header.querySelector("nav");
        if (nav) {
            originalNavMarkup = nav.innerHTML;
            const pdfLink = nav.querySelector('a[href$=".pdf"], a[href="documents.html"]');
            for (const node of [...nav.childNodes]) {
                if (node.nodeType === Node.TEXT_NODE ? node.textContent.trim() === "|" : node.matches?.('a:not(.nav-button):not([href="home-index.html"])')) {
                    node.remove();
                }
            }
            for (const node of [...nav.childNodes]) {
                if (node.nodeType === Node.TEXT_NODE && node.textContent.includes("|")) {
                    node.textContent = node.textContent.replace(/\|/g, "");
                }
            }
            for (const [label, links] of navMenus) {
                nav.insertBefore(buildNavMenu(label, links), pdfLink);
            }
            // Every page except the home page gets a search box in the middle of the header.
            if (!document.querySelector(".site-search")) {
                const headerSearch = document.createElement("form");
                headerSearch.className = "site-search wiki-header-search";
                headerSearch.setAttribute("role", "search");
                headerSearch.dataset.wikiInjected = "";
                headerSearch.innerHTML = `
                    <label class="visually-hidden" for="site-search-input">Search site content</label>
                    <input id="site-search-input" type="search" name="q" placeholder="Search the wiki..." autocomplete="off" aria-autocomplete="list" aria-controls="search-suggestions">
                    <button type="submit">Search</button>
                    <ul id="search-suggestions" class="search-suggestions" aria-label="Search suggestions" hidden></ul>
                    <p id="search-status" class="search-status" aria-live="polite"></p>
                `;
                nav.insertBefore(headerSearch, pdfLink);
                if (!document.querySelector('script[src$="search.js"]')) {
                    const searchScript = document.createElement("script");
                    searchScript.src = "search.js";
                    searchScript.dataset.wikiInjected = "";
                    document.body.append(searchScript);
                }
            }
            const newPageButton = document.createElement("button");
            newPageButton.type = "button";
            newPageButton.className = "nav-button wiki-new-page-button";
            newPageButton.dataset.wikiInjected = "";
            newPageButton.textContent = "+ New page";
            newPageButton.addEventListener("click", () => openNewPageDialog());
            nav.append(newPageButton);

            // "Log in" while signed out, the account name while signed in; both go to the login page.
            const accountLink = document.createElement("a");
            accountLink.className = "nav-button wiki-account-link";
            accountLink.dataset.wikiInjected = "";
            const accountName = readToken() && readAccount();
            accountLink.href = accountName || currentPage === "login.html" ? "login.html" : `login.html?${new URLSearchParams({ next: currentPage + location.search + location.hash })}`;
            accountLink.textContent = accountName ? `👤 ${accountName}` : "Log in";
            accountLink.title = accountName ? `Signed in as ${accountName} (${readRole()})` : "Log in or register";
            nav.append(accountLink);
            if (canReviewRole(readRole())) {
                const adminLink = document.createElement("a");
                adminLink.className = "nav-button wiki-admin-link";
                adminLink.dataset.wikiInjected = "";
                adminLink.href = "admin.html";
                adminLink.textContent = readRole() === "admin" ? "Admin" : "Review";
                nav.append(adminLink);
            }
            if (accountName) {
                const signOutButton = document.createElement("button");
                signOutButton.type = "button";
                signOutButton.className = "nav-button wiki-sign-out-button";
                signOutButton.dataset.wikiInjected = "";
                signOutButton.textContent = "Sign out";
                signOutButton.title = `Sign out of ${accountName} on this device`;
                signOutButton.addEventListener("click", () => {
                    forgetToken();
                    forgetAccount();
                    location.reload();
                });
                nav.append(signOutButton);
            }

            // "Open PDF" goes to the page listing every PDF and its older versions.
            if (pdfLink) {
                pdfLink.href = "documents.html";
                for (const name of ["target", "rel", "aria-haspopup", "aria-expanded"]) {
                    pdfLink.removeAttribute(name);
                }
            }
        }
    }

    const editButton = toolbar.querySelector('[data-action="edit"]');
    const saveButton = toolbar.querySelector('[data-action="save"]');
    const cancelButton = toolbar.querySelector('[data-action="cancel"]');
    const commitButton = toolbar.querySelector('[data-action="commit"]');
    const downloadButton = toolbar.querySelector('[data-action="download"]');
    const resetButton = toolbar.querySelector('[data-action="reset"]');
    const bookmarkButton = document.createElement("button");
    bookmarkButton.type = "button";
    bookmarkButton.className = "wiki-bookmark-button";
    bookmarkButton.setAttribute("aria-pressed", "false");
    const bookmarkStatus = status;
    if (!isNewPage) {
        toolbar.insertBefore(bookmarkButton, commitButton);
    }

    const bookmarkedPagesList = document.querySelector("#bookmarked-pages-list");

    function readBookmarks() {
        const serialized = localStorage.getItem(bookmarkStorageKey);
        if (serialized === null) {
            return [];
        }

        const parsed = JSON.parse(serialized);
        if (!Array.isArray(parsed) || parsed.some((page) =>
            !page ||
            typeof page.href !== "string" ||
            !/^[\w.-]+\.html$/.test(page.href) ||
            typeof page.title !== "string"
        )) {
            throw new Error("Saved bookmarks have an invalid format.");
        }
        return parsed;
    }

    function renderBookmarks(pages) {
        if (bookmarkedPagesList) {
            bookmarkedPagesList.replaceChildren();
            if (pages.length === 0) {
                const emptyMessage = document.createElement("p");
                emptyMessage.textContent = "You have not bookmarked any pages yet.";
                bookmarkedPagesList.append(emptyMessage);
            } else {
                const list = document.createElement("ul");
                for (const page of pages) {
                    const item = document.createElement("li");
                    const link = document.createElement("a");
                    link.href = page.href;
                    link.textContent = page.title;
                    item.append(link);
                    list.append(item);
                }
                bookmarkedPagesList.append(list);
            }
        }

        const isBookmarked = pages.some((page) => page.href === currentPage);
        bookmarkButton.setAttribute("aria-pressed", String(isBookmarked));
        bookmarkButton.textContent = isBookmarked ? "★ Bookmarked" : "☆ Bookmark";
        bookmarkButton.title = isBookmarked ? "Remove this page from your bookmarks" : "Bookmark this page";
    }

    bookmarkButton.addEventListener("click", () => {
        try {
            const pages = readBookmarks();
            const existingIndex = pages.findIndex((page) => page.href === currentPage);
            if (existingIndex === -1) {
                pages.push({ href: currentPage, title: getCurrentTitle() });
                bookmarkStatus.textContent = "Page bookmarked.";
            } else {
                pages.splice(existingIndex, 1);
                bookmarkStatus.textContent = "Bookmark removed.";
            }
            localStorage.setItem(bookmarkStorageKey, JSON.stringify(pages));
            renderBookmarks(pages);
        } catch (error) {
            bookmarkStatus.textContent = `Could not save bookmarks: ${error.message}`;
        }
    });

    window.addEventListener("storage", (event) => {
        if (event.key === bookmarkStorageKey) {
            try {
                renderBookmarks(readBookmarks());
            } catch (error) {
                bookmarkStatus.textContent = `Could not load bookmarks: ${error.message}`;
            }
        }
    });

    try {
        renderBookmarks(readBookmarks());
    } catch (error) {
        bookmarkStatus.textContent = `Could not load bookmarks: ${error.message}`;
        if (bookmarkedPagesList) {
            bookmarkedPagesList.textContent = `Could not load bookmarks: ${error.message}`;
        }
    }

    // Formatting bar shown at the bottom of the screen while editing.
    const formatBar = document.createElement("section");
    formatBar.className = "wiki-format-bar";
    formatBar.setAttribute("aria-label", "Formatting tools");
    formatBar.hidden = true;
    formatBar.innerHTML = `
        <div class="wiki-format-group">
            <select data-command="block" title="Text style" aria-label="Text style">
                <option value="p">Paragraph</option>
                <option value="h1">Heading 1</option>
                <option value="h2">Heading 2</option>
                <option value="h3">Heading 3</option>
                <option value="h4">Heading 4</option>
                <option value="blockquote">Quote</option>
                <option value="pre">Code block</option>
            </select>
            <select data-command="font" title="Font" aria-label="Font">
                <option value="" disabled selected>Font…</option>
                <option value="default">Default</option>
                <option value="roman" class="roman">Times New Roman</option>
                <option value="consolas" class="consolas">Consolas</option>
                <option value="georgia" class="georgia">Georgia</option>
                <option value="comic" class="comic">Comic Sans</option>
            </select>
        </div>
        <div class="wiki-format-group">
            <button type="button" data-command="bold" title="Bold (Ctrl+B)" aria-label="Bold"><b>B</b></button>
            <button type="button" data-command="italic" title="Italic (Ctrl+I)" aria-label="Italic"><i>I</i></button>
            <button type="button" data-command="underline" title="Underline (Ctrl+U)" aria-label="Underline"><u>U</u></button>
            <button type="button" data-command="strikeThrough" title="Strikethrough" aria-label="Strikethrough"><s>S</s></button>
            <button type="button" data-command="superscript" title="Superscript" aria-label="Superscript">x<sup>2</sup></button>
            <button type="button" data-command="subscript" title="Subscript" aria-label="Subscript">x<sub>2</sub></button>
            <button type="button" data-command="inlineCode" title="Inline code" aria-label="Inline code"><span class="consolas">&lt;/&gt;</span></button>
        </div>
        <div class="wiki-format-group">
            <label class="wiki-color-control" title="Text color">A<input type="color" data-command="foreColor" value="#1f4b5a" aria-label="Text color"></label>
            <label class="wiki-color-control" title="Highlight color">🖍<input type="color" data-command="hiliteColor" value="#fff4c2" aria-label="Highlight color"></label>
        </div>
        <div class="wiki-format-group">
            <button type="button" data-command="insertUnorderedList" title="Bullet list">• List</button>
            <button type="button" data-command="insertOrderedList" title="Numbered list">1. List</button>
            <button type="button" data-command="outdent" title="Decrease indent" aria-label="Decrease indent">Outdent</button>
            <button type="button" data-command="indent" title="Increase indent" aria-label="Increase indent">Indent</button>
        </div>
        <div class="wiki-format-group">
            <button type="button" data-command="justifyLeft" title="Align left" aria-label="Align left">Left</button>
            <button type="button" data-command="justifyCenter" title="Align center" aria-label="Align center">Center</button>
            <button type="button" data-command="justifyRight" title="Align right" aria-label="Align right">Right</button>
        </div>
        <div class="wiki-format-group">
            <button type="button" data-command="textBox" title="Insert a text box">+ Text box</button>
            <button type="button" data-command="codeBox" title="Insert a code box">+ Code box</button>
            <button type="button" data-command="table" title="Insert a table">+ Table</button>
            <button type="button" data-command="rawHtml" title="Insert a block of raw HTML">+ HTML</button>
            <button type="button" data-command="link" title="Add a link">Link</button>
            <button type="button" data-command="image" title="Insert an image from a URL">Image</button>
            <button type="button" data-command="insertHorizontalRule" title="Insert a divider line">Divider</button>
        </div>
        <div class="wiki-format-group">
            <button type="button" data-command="clearFormatting" title="Clear formatting">Clear</button>
            <button type="button" data-command="removeAllStyles" title="Remove every style, including inline code, from the selection (or the whole page if nothing is selected)">Remove all styles</button>
            <button type="button" data-command="undo" title="Undo (Ctrl+Z)" aria-label="Undo">Undo</button>
            <button type="button" data-command="redo" title="Redo (Ctrl+Shift+Z)" aria-label="Redo">Redo</button>
        </div>
    `;
    document.body.append(formatBar);
    const blockSelect = formatBar.querySelector('[data-command="block"]');
    const fontSelect = formatBar.querySelector('[data-command="font"]');

    function escapeHtml(text) {
        const element = document.createElement("span");
        element.textContent = text;
        return element.innerHTML;
    }

    document.addEventListener("selectionchange", () => {
        const selection = document.getSelection();
        if (!editing || selection.rangeCount === 0) {
            return;
        }
        const range = selection.getRangeAt(0);
        if (!root.contains(range.commonAncestorContainer)) {
            return;
        }
        savedRange = range.cloneRange();

        const start = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer : range.startContainer.parentElement;
        const block = start.closest("h1, h2, h3, h4, blockquote, pre, p, li, td, th, div");
        const tag = block && root.contains(block) ? block.tagName.toLowerCase() : "p";
        blockSelect.value = [...blockSelect.options].some((option) => option.value === tag) ? tag : "p";
    });

    function restoreSelection() {
        const selection = document.getSelection();
        const range = selection.rangeCount > 0 && root.contains(selection.getRangeAt(0).commonAncestorContainer)
            ? selection.getRangeAt(0).cloneRange()
            : savedRange;
        root.focus({ preventScroll: true });
        if (range) {
            selection.removeAllRanges();
            selection.addRange(range);
        }
    }

    // Chrome puts new lists inside the paragraph they were made from; move them out so the HTML stays valid.
    function unwrapListsFromParagraphs() {
        for (const list of root.querySelectorAll("p > ul, p > ol")) {
            const paragraph = list.parentElement;
            if (!paragraph.textContent.replace(list.textContent, "").trim()) {
                paragraph.replaceWith(...paragraph.childNodes);
            } else {
                paragraph.after(list);
            }
        }
    }

    function hasTextSelected() {
        const selection = document.getSelection();
        return selection.rangeCount > 0 && !selection.isCollapsed && root.contains(selection.getRangeAt(0).commonAncestorContainer);
    }

    // execCommand has no "wrap in this element" command, so mark the selection with a fake font and swap it out.
    function wrapSelection(makeElement) {
        const marker = "wiki-selection-marker";
        document.execCommand("styleWithCSS", false, false);
        document.execCommand("fontName", false, marker);
        for (const font of root.querySelectorAll(`font[face="${marker}"]`)) {
            const replacement = makeElement(font);
            if (replacement) {
                replacement.append(...font.childNodes);
                font.replaceWith(replacement);
            } else {
                font.replaceWith(...font.childNodes);
            }
        }
    }

    function applyFont(className) {
        wrapSelection((font) => {
            for (const span of font.querySelectorAll("span")) {
                span.classList.remove(...fontClasses);
                if (!span.classList.length && !span.hasAttribute("style")) {
                    span.replaceWith(...span.childNodes);
                } else if (!span.classList.length) {
                    span.removeAttribute("class");
                }
            }
            if (className === "default") {
                return null;
            }
            const span = document.createElement("span");
            span.className = className;
            return span;
        });
    }

    const styleTags = new Set([
        "ABBR", "B", "CODE", "DEL", "EM", "FONT", "I", "INS", "KBD", "MARK", "S", "SMALL", "SPAN", "STRIKE", "STRONG", "SUB", "SUP", "U"
    ]);

    function isStyleElement(element) {
        return styleTags.has(element.tagName) && !element.hasAttribute("data-wiki-island");
    }

    function stripStyles(container) {
        for (const element of [...container.querySelectorAll("*")]) {
            if (element.closest("[data-wiki-island], .wiki-raw-html")) {
                continue;
            }
            if (isStyleElement(element)) {
                element.replaceWith(...element.childNodes);
            } else {
                element.removeAttribute("style");
            }
        }
    }

    // Move `node` out of every styled ancestor in its block, splitting those ancestors so text
    // before and after the node keeps its formatting.
    function liftOutOfStyles(node) {
        for (let ancestor = node.parentElement; ancestor && root.contains(ancestor) && ancestor !== root; ancestor = node.parentElement) {
            if (!isStyleElement(ancestor)) {
                break;
            }
            for (const [start, end, insert] of [
                [(range) => range.setStart(ancestor, 0), (range) => range.setEndBefore(node), (clone) => ancestor.before(clone)],
                [(range) => range.setStartAfter(node), (range) => range.setEnd(ancestor, ancestor.childNodes.length), (clone) => ancestor.after(clone)]
            ]) {
                const range = document.createRange();
                start(range);
                end(range);
                const piece = range.extractContents();
                if (piece.textContent) {
                    const clone = ancestor.cloneNode(false);
                    clone.append(piece);
                    insert(clone);
                }
            }
            ancestor.replaceWith(...ancestor.childNodes);
        }
    }

    function removeAllStyles() {
        if (!hasTextSelected()) {
            if (!window.confirm("Nothing is selected. Remove all styles from the whole page?")) {
                return;
            }
            stripStyles(root);
            status.textContent = "Removed all styles from the page.";
            return;
        }

        const marker = "wiki-selection-marker";
        document.execCommand("styleWithCSS", false, false);
        document.execCommand("fontName", false, marker);
        const markers = [...root.querySelectorAll(`font[face="${marker}"]`)];
        for (const font of markers) {
            liftOutOfStyles(font);
            stripStyles(font);
            // Editors like VS Code put the background on a box around every line, so clear each level up to the page.
            for (let block = font.parentElement; block && block !== root; block = block.parentElement) {
                block.removeAttribute("style");
            }
        }
        const selection = document.getSelection();
        if (markers.length > 0) {
            const first = markers[0].firstChild;
            const last = markers.at(-1).lastChild;
            for (const font of markers) {
                font.replaceWith(...font.childNodes);
            }
            const range = document.createRange();
            range.setStartBefore(first);
            range.setEndAfter(last);
            selection.removeAllRanges();
            selection.addRange(range);
        }
        root.normalize();
        status.textContent = "Removed all styles from the selection.";
    }

    // insertHTML flattens blocks that land inside a paragraph, so place new blocks after the current one instead.
    function insertBlock(markup) {
        const template = document.createElement("template");
        template.innerHTML = markup.trim();
        const block = template.content.firstElementChild;
        if (hasTextSelected()) {
            document.execCommand("delete");
        }

        const selection = document.getSelection();
        let current = selection.rangeCount > 0 ? selection.getRangeAt(0).endContainer : null;
        if (current && current.nodeType !== Node.ELEMENT_NODE) {
            current = current.parentElement;
        }
        if (!current || current === root || !root.contains(current)) {
            current = null;
        }
        while (current && !current.parentElement.matches(".wiki-content, .main, section, footer, details")) {
            current = current.parentElement;
        }

        if (current) {
            current.after(block);
            if (current.matches("p") && !current.textContent.trim() && !current.querySelector("img, [data-wiki-island]")) {
                current.remove();
            }
        } else {
            root.append(block);
        }
        if (!block.nextElementSibling) {
            const paragraph = document.createElement("p");
            paragraph.append(document.createElement("br"));
            block.after(paragraph);
        }

        // Select the placeholder text itself (not its element) so typing replaces it but keeps the formatting.
        const target = block.querySelector("p, code, th, td") || block;
        const range = document.createRange();
        range.selectNodeContents(target.firstChild?.nodeType === Node.TEXT_NODE ? target.firstChild : target);
        selection.removeAllRanges();
        selection.addRange(range);
    }

    function selectedText() {
        return hasTextSelected() ? document.getSelection().toString() : "";
    }

    function runCommand(command, value) {
        if (!editing) {
            return;
        }
        restoreSelection();

        switch (command) {
            case "block":
                document.execCommand("formatBlock", false, `<${value}>`);
                break;
            case "font":
                if (!hasTextSelected()) {
                    status.textContent = "Select some text first, then pick a font.";
                    break;
                }
                applyFont(value);
                break;
            case "inlineCode":
                if (!hasTextSelected()) {
                    status.textContent = "Select some text first to mark it as code.";
                    break;
                }
                wrapSelection(() => {
                    const code = document.createElement("code");
                    code.className = "consolas";
                    return code;
                });
                break;
            case "foreColor":
            case "hiliteColor":
                document.execCommand("styleWithCSS", false, true);
                document.execCommand(command, false, value);
                document.execCommand("styleWithCSS", false, false);
                break;
            case "rawHtml":
                openRawHtmlDialog(null);
                break;
            case "textBox":
                insertBlock(`<div class="wiki-textbox"><p>${escapeHtml(selectedText()) || "New text box"}</p></div>`);
                break;
            case "codeBox":
                insertBlock(`<pre class="code-box"><code class="consolas">${escapeHtml(selectedText()) || "Code goes here"}</code></pre>`);
                break;
            case "table":
                insertBlock(`
                    <table>
                        <thead><tr><th>Heading</th><th>Heading</th><th>Heading</th></tr></thead>
                        <tbody>
                            <tr><td>Cell</td><td>Cell</td><td>Cell</td></tr>
                            <tr><td>Cell</td><td>Cell</td><td>Cell</td></tr>
                        </tbody>
                    </table>`);
                break;
            case "link": {
                const text = selectedText();
                const url = window.prompt("Link address (for example page-voidstone.html or https://…)");
                restoreSelection();
                if (!url) {
                    break;
                }
                if (!isSafeUrl(url)) {
                    status.textContent = "That link address is not allowed.";
                    break;
                }
                if (text) {
                    document.execCommand("createLink", false, url);
                } else {
                    document.execCommand("insertHTML", false, `<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>`);
                }
                break;
            }
            case "image": {
                const url = window.prompt("Image address (URL or file name in the wiki folder)");
                restoreSelection();
                if (!url) {
                    break;
                }
                if (!isSafeUrl(url)) {
                    status.textContent = "That image address is not allowed.";
                    break;
                }
                const alt = window.prompt("Short description of the image (for screen readers)") || "";
                restoreSelection();
                document.execCommand("insertHTML", false, `<img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}">`);
                break;
            }
            case "clearFormatting":
                document.execCommand("removeFormat");
                if (hasTextSelected()) {
                    applyFont("default");
                }
                break;
            case "removeAllStyles":
                removeAllStyles();
                break;
            case "insertUnorderedList":
            case "insertOrderedList":
                document.execCommand(command);
                unwrapListsFromParagraphs();
                break;
            default:
                document.execCommand(command);
        }
    }

    formatBar.addEventListener("mousedown", (event) => {
        // Keep the text selection in the page when a toolbar button is pressed.
        if (event.target.closest("button")) {
            event.preventDefault();
        }
    });

    formatBar.addEventListener("click", (event) => {
        const button = event.target.closest("button[data-command]");
        if (button) {
            runCommand(button.dataset.command);
        }
    });

    formatBar.addEventListener("change", (event) => {
        const control = event.target.closest("[data-command]");
        if (control) {
            runCommand(control.dataset.command, control.value);
        }
        fontSelect.value = "";
    });

    function placeCaret(container, offset) {
        const range = document.createRange();
        range.setStart(container, offset);
        range.collapse(true);
        const selection = document.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
    }

    function lastListItemIn(item) {
        let nested = item.lastElementChild;
        while (nested && /^(UL|OL)$/.test(nested.tagName) && nested.lastElementChild) {
            item = nested.lastElementChild;
            nested = item.lastElementChild;
        }
        return item;
    }

    // Backspace at the start of a list item: the first press removes its bullet (or number),
    // the second joins the line onto the end of the previous item.
    root.addEventListener("keydown", (event) => {
        if (!editing || event.key !== "Backspace" || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) {
            return;
        }
        const selection = document.getSelection();
        if (selection.rangeCount === 0 || !selection.isCollapsed) {
            return;
        }
        const caret = selection.getRangeAt(0);
        const start = caret.startContainer.nodeType === Node.ELEMENT_NODE ? caret.startContainer : caret.startContainer.parentElement;
        const item = start.closest("li");
        if (!item || !root.contains(item)) {
            return;
        }
        const before = document.createRange();
        before.setStart(item, 0);
        before.setEnd(caret.startContainer, caret.startOffset);
        if (before.toString() !== "" || before.cloneContents().querySelector("img")) {
            return;
        }

        event.preventDefault();
        if (!item.classList.contains("wiki-plain")) {
            item.classList.add("wiki-plain");
            return;
        }

        const ownContent = [...item.childNodes].filter((node) => !/^(UL|OL)$/.test(node.nodeName));
        const hasText = ownContent.some((node) => node.textContent.trim() || node.nodeName === "IMG");
        const previous = item.previousElementSibling && lastListItemIn(item.previousElementSibling);

        if (!previous) {
            // First item in the list: move the line out above the list as a normal paragraph.
            const paragraph = document.createElement("p");
            paragraph.append(...(hasText ? ownContent : [document.createElement("br")]));
            item.parentElement.before(paragraph);
            item.replaceWith(...item.childNodes);
            if (!paragraph.nextElementSibling?.children.length) {
                paragraph.nextElementSibling?.remove();
            }
            placeCaret(paragraph, 0);
            return;
        }

        if (hasText && previous.lastChild?.nodeName === "BR") {
            previous.lastChild.remove();
        }
        const joinPoint = previous.childNodes.length;
        if (hasText) {
            previous.append(...ownContent);
        }
        const nestedLists = [...item.children].filter((child) => /^(UL|OL)$/.test(child.tagName));
        previous.append(...nestedLists);
        item.remove();
        placeCaret(previous, joinPoint);
    });

    root.addEventListener("paste", (event) => {
        if (!editing) {
            return;
        }
        event.preventDefault();
        const html = event.clipboardData.getData("text/html");
        if (html) {
            document.execCommand("insertHTML", false, sanitizeMarkup(html, { keepIslands: false }));
        } else {
            document.execCommand("insertText", false, event.clipboardData.getData("text/plain"));
        }
    });

    function markRawBlocks(value) {
        for (const block of root.querySelectorAll(".wiki-raw-html")) {
            if (value) {
                block.contentEditable = "false";
                block.title = "HTML block: click to edit its HTML";
            } else {
                block.removeAttribute("contenteditable");
                block.removeAttribute("title");
            }
        }
    }

    // Write or change a block of raw HTML. block is null for a new one.
    function openRawHtmlDialog(block) {
        const dialog = document.createElement("dialog");
        dialog.className = "wiki-dialog wiki-raw-html-dialog";
        dialog.dataset.wikiInjected = "";
        dialog.innerHTML = `
            <form method="dialog">
                <h2>${block ? "Edit HTML block" : "Insert HTML"}</h2>
                <label for="wiki-raw-html-source">HTML</label>
                <textarea id="wiki-raw-html-source" rows="14" spellcheck="false" class="consolas"></textarea>
                <p class="wiki-dialog-hint">Any HTML tags work, including &lt;style&gt;, &lt;iframe&gt; and forms. Scripts, onclick-style attributes and javascript: links are removed when the block is saved.</p>
                <div class="wiki-dialog-actions">
                    ${block ? '<button type="button" data-raw="delete">Delete block</button>' : ""}
                    <button type="button" data-raw="cancel">Cancel</button>
                    <button type="submit" class="wiki-primary">${block ? "Update" : "Insert"}</button>
                </div>
            </form>
        `;
        const source = dialog.querySelector("textarea");
        source.value = block ? cleanRawHtml(block.innerHTML).trim() : "";
        dialog.querySelector('[data-raw="cancel"]').addEventListener("click", () => dialog.close());
        dialog.querySelector('[data-raw="delete"]')?.addEventListener("click", () => {
            block.remove();
            dialog.close();
        });
        dialog.querySelector("form").addEventListener("submit", (event) => {
            event.preventDefault();
            const markup = cleanRawHtml(source.value).trim();
            dialog.close();
            if (!markup) {
                return;
            }
            if (block) {
                block.innerHTML = markup;
            } else {
                restoreSelection();
                insertBlock(`<div class="wiki-raw-html">${markup}</div>`);
                markRawBlocks(true);
                document.getSelection().removeAllRanges();
            }
            status.textContent = source.value.trim() === markup ? "HTML block saved." : "HTML block saved. Parts that could run scripts were removed.";
        });
        dialog.addEventListener("close", () => dialog.remove());
        document.body.append(dialog);
        dialog.showModal();
        source.focus();
    }

    root.addEventListener("click", (event) => {
        const block = editing && event.target.closest(".wiki-raw-html");
        if (block && root.contains(block)) {
            event.preventDefault();
            openRawHtmlDialog(block);
        }
    });

    // Reviewers' page edits ---------------------------------------------------------------------------------
    // When a reviewer commits a page, every paragraph or block they added, changed or deleted is wrapped in a
    // <div class="wiki-pending"> that remembers the original. It shows in red until an admin approves it (the
    // change stays) or disapproves it (the original comes back).
    const pendingPagesFile = "pending-pages.json";
    const todoFile = "todo.json";
    const pendingSelector = "div.wiki-pending";
    const draftPrefix = /^\[draft\]\s*/i;

    function pendingWrapper(inner, original, name, date, removal = false) {
        const wrapper = document.createElement("div");
        wrapper.className = removal ? "wiki-pending wiki-pending-removal" : "wiki-pending";
        wrapper.dataset.pendingBy = name;
        wrapper.dataset.pendingDate = date;
        wrapper.dataset.original = encodeBase64(original);
        wrapper.innerHTML = inner;
        return wrapper.outerHTML;
    }

    function topLevelBlocks(markup) {
        const template = document.createElement("template");
        template.innerHTML = markup;
        return [...template.content.childNodes]
            .filter((node) => node.nodeType === Node.ELEMENT_NODE || node.textContent.trim())
            .map((node) => node.nodeType === Node.ELEMENT_NODE ? node.outerHTML : escapeHtml(node.textContent));
    }

    const isPendingMarkup = (markup) => /^<div class="wiki-pending[" ]/.test(markup);

    // Compares the page as committed with the reviewer's version, block by block (longest common subsequence),
    // and wraps whatever differs.
    function markPendingChanges(baseMarkup, newMarkup, name) {
        const before = topLevelBlocks(baseMarkup);
        const after = topLevelBlocks(newMarkup);
        const lengths = Array.from({ length: before.length + 1 }, () => new Array(after.length + 1).fill(0));
        for (let i = before.length - 1; i >= 0; i--) {
            for (let j = after.length - 1; j >= 0; j--) {
                lengths[i][j] = before[i] === after[j] ? lengths[i + 1][j + 1] + 1 : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
            }
        }
        const date = new Date().toISOString();
        const output = [];
        let removed = [];
        let added = [];
        const flush = () => {
            // Blocks that were already waiting for review keep their wrapper and original
            const keptPending = added.filter(isPendingMarkup);
            const newBlocks = added.filter((markup) => !isPendingMarkup(markup));
            const oldBlocks = removed.filter((markup) => !isPendingMarkup(markup));
            // A deleted block that was itself waiting for review goes back to its original, marked for removal
            for (const markup of removed.filter(isPendingMarkup)) {
                const template = document.createElement("template");
                template.innerHTML = markup;
                const block = template.content.firstElementChild;
                const stillThere = keptPending.some((kept) => kept.includes(`data-pending-date="${block.dataset.pendingDate}"`) && kept.includes(`data-pending-by="${escapeHtml(block.dataset.pendingBy || "")}"`));
                const original = block.dataset.original ? decodeBase64(block.dataset.original) : "";
                if (!stillThere && original) oldBlocks.push(original);
            }
            output.push(...keptPending);
            const paired = Math.min(oldBlocks.length, newBlocks.length);
            for (let index = 0; index < paired; index++) output.push(pendingWrapper(newBlocks[index], oldBlocks[index], name, date));
            for (const markup of newBlocks.slice(paired)) output.push(pendingWrapper(markup, "", name, date));
            for (const markup of oldBlocks.slice(paired)) output.push(pendingWrapper(markup, markup, name, date, true));
            removed = [];
            added = [];
        };
        let i = 0;
        let j = 0;
        while (i < before.length || j < after.length) {
            if (i < before.length && j < after.length && before[i] === after[j]) {
                flush();
                output.push(after[j]);
                i++;
                j++;
            } else if (j < after.length && (i >= before.length || lengths[i][j + 1] >= lengths[i + 1][j])) {
                added.push(after[j++]);
            } else {
                removed.push(before[i++]);
            }
        }
        flush();
        return output.join("\n");
    }

    // Takes out the [UNRESOLVED] callouts and tags. "[UNRESOLVED: ... DO NOT CHANGE ...]" is a request from people, so it stays.
    function stripUnresolvedNotes(markup) {
        const keep = (match, note) => /do not change/i.test(note) ? match : "";
        return markup
            .replace(/[ \t]*<(p|footer)\b[^>]*>\s*(?:<(?:strong|b)>)?\s*(\[unresolved\b[^\]<]*\])(?:\s*The source[^<]*)?\s*(?:<\/(?:strong|b)>)?\s*<\/\1>[ \t]*(?:\r?\n)?/gi, (match, tag, note) => keep(match, note))
            .replace(/[ \t]*(\[unresolved\b[^\]<]*\])/gi, keep);
    }

    function pendingBlocks() {
        return [...root.querySelectorAll(pendingSelector)];
    }

    function describePending(block) {
        const when = block.dataset.pendingDate ? new Date(block.dataset.pendingDate).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : "";
        const kind = block.classList.contains("wiki-pending-removal") ? "Deletion" : block.dataset.original ? "Change" : "Addition";
        return `${kind} by ${block.dataset.pendingBy || "a reviewer"}${when ? `, ${when}` : ""}`;
    }

    // Approving keeps the change; disapproving puts the original back (or drops an added block)
    function resolvePending(block, approve) {
        const removal = block.classList.contains("wiki-pending-removal");
        if (approve) {
            if (removal) {
                block.remove();
            } else {
                block.replaceWith(...block.childNodes);
            }
        } else {
            const template = document.createElement("template");
            template.innerHTML = sanitizeMarkup(block.dataset.original ? decodeBase64(block.dataset.original) : "");
            block.replaceWith(template.content);
        }
    }

    async function updatePendingPages(token, change, message) {
        return updateRepositoryJson(token, pendingPagesFile, (data) => {
            data.pages = data.pages || {};
            change(data.pages);
        }, message);
    }

    // "[draft] X" becomes "X" in search once the draft is approved
    async function renameDraftInSearch(token, file, title) {
        const searchFile = await getRepositoryFile(token, "search.js");
        const line = searchFile?.text.split("\n").find((text) => text.includes(`href: ${JSON.stringify(file)}`));
        if (line) {
            const renamed = line.replace(`title: ${JSON.stringify(title)}`, `title: ${JSON.stringify(title.replace(draftPrefix, ""))}`);
            await putRepositoryFile(token, "search.js", searchFile.text.replace(line, renamed), `Rename ${title} in search`, searchFile.sha);
        }
    }

    // Commits the page after an admin or editor approved or disapproved changes
    async function commitReview(message, { approveDraft = false } = {}) {
        const token = readToken();
        if (!token || !canReviewRole(readRole()) || !canReviewRole(await checkAccount(token))) {
            throw new Error("Only admins and editors can approve changes. Log in as one.");
        }
        const title = getCurrentTitle();
        if (approveDraft && draftPrefix.test(title)) {
            const heading = root.querySelector("h1");
            if (heading) heading.textContent = title.replace(draftPrefix, "");
            document.title = document.title.replace(draftPrefix, "");
        }
        savedContent = serializeContent();
        const existing = await getRepositoryFile(token, targetFile);
        const pageHtml = buildPageHtml().replace(/\r?\n/g, !existing || existing.text.includes("\r\n") ? "\r\n" : "\n");
        await putRepositoryFile(token, targetFile, pageHtml, message, existing?.sha);
        try {
            localStorage.removeItem(storageKey);
        } catch {
            // The draft simply stays in this browser.
        }
        if (approveDraft && draftPrefix.test(title)) {
            await renameDraftInSearch(token, targetFile, title);
        }
        if (!pendingBlocks().length) {
            await updatePendingPages(token, (pages) => { delete pages[targetFile]; }, `Update review queue for ${title.replace(draftPrefix, "")} page`);
        }
    }

    const reviewBanner = document.createElement("div");
    reviewBanner.className = "wiki-review-banner";
    reviewBanner.dataset.wikiInjected = "";
    reviewBanner.hidden = true;
    root.before(reviewBanner);

    const reviewPopover = document.createElement("div");
    reviewPopover.className = "wiki-review-popover";
    reviewPopover.dataset.wikiInjected = "";
    reviewPopover.hidden = true;
    document.body.append(reviewPopover);

    async function runReview(action, message, options) {
        reviewPopover.hidden = true;
        const before = root.innerHTML;
        try {
            action();
            status.textContent = "Saving the review…";
            await commitReview(message, options);
            status.textContent = "Saved. The live site usually updates within a minute or two.";
        } catch (error) {
            root.innerHTML = before;
            status.textContent = `Could not save the review: ${error.message}`;
        }
        renderReviewState();
    }

    function renderReviewState() {
        const blocks = pendingBlocks();
        const title = getCurrentTitle();
        const isDraft = draftPrefix.test(title);
        reviewBanner.hidden = !blocks.length && !isDraft;
        if (reviewBanner.hidden) {
            return;
        }
        const admin = canReviewRole(readRole());
        reviewBanner.replaceChildren();
        const text = document.createElement("span");
        text.textContent = isDraft
            ? `This is a draft page. ${blocks.length ? `${blocks.length} part${blocks.length === 1 ? "" : "s"} still need${blocks.length === 1 ? "s" : ""} an admin's or editor's approval.` : "Every part is approved; an admin can publish it."}`
            : `${blocks.length} change${blocks.length === 1 ? "" : "s"} on this page ${blocks.length === 1 ? "is" : "are"} waiting for an admin's or editor's review and show${blocks.length === 1 ? "s" : ""} in red.`;
        reviewBanner.append(text);
        if (admin) {
            const button = (label, className, onclick) => {
                const element = document.createElement("button");
                element.type = "button";
                element.className = className;
                element.textContent = label;
                element.addEventListener("click", onclick);
                reviewBanner.append(element);
            };
            const plain = title.replace(draftPrefix, "");
            button(isDraft ? "Approve entire draft" : "Approve all", "wiki-review-approve", () => runReview(
                () => pendingBlocks().forEach((block) => resolvePending(block, true)),
                isDraft ? `${readAccount()} approves the draft ${plain} page` : `${readAccount()} approves all changes to ${plain} page`,
                { approveDraft: isDraft }));
            if (blocks.length) {
                button("Disapprove all", "wiki-review-disapprove", () => {
                    if (window.confirm(`Undo all ${blocks.length} pending change${blocks.length === 1 ? "" : "s"} on this page?`)) {
                        runReview(() => pendingBlocks().forEach((block) => resolvePending(block, false)), `${readAccount()} disapproves all changes to ${plain} page`);
                    }
                });
            }
            const hint = document.createElement("span");
            hint.className = "wiki-review-hint";
            hint.textContent = "Click a red part to review it on its own.";
            if (blocks.length) reviewBanner.append(hint);
        }
    }

    function showReviewPopover(block) {
        const plain = getCurrentTitle().replace(draftPrefix, "");
        reviewPopover.replaceChildren();
        const info = document.createElement("p");
        info.textContent = describePending(block);
        reviewPopover.append(info);
        if (block.dataset.original && !block.classList.contains("wiki-pending-removal")) {
            const original = document.createElement("details");
            const summary = document.createElement("summary");
            summary.textContent = "Show the original";
            const body = document.createElement("div");
            body.className = "wiki-review-original";
            body.innerHTML = sanitizeMarkup(decodeBase64(block.dataset.original));
            original.append(summary, body);
            reviewPopover.append(original);
        }
        const actions = document.createElement("p");
        for (const [label, className, approve] of [["Approve", "wiki-review-approve", true], ["Disapprove", "wiki-review-disapprove", false]]) {
            const button = document.createElement("button");
            button.type = "button";
            button.className = className;
            button.textContent = label;
            button.addEventListener("click", () => runReview(() => resolvePending(block, approve),
                `${readAccount()} ${approve ? "approves" : "disapproves"} a change to ${plain} page`));
            actions.append(button);
        }
        const close = document.createElement("button");
        close.type = "button";
        close.textContent = "Close";
        close.addEventListener("click", () => { reviewPopover.hidden = true; });
        actions.append(close);
        reviewPopover.append(actions);
        const rect = block.getBoundingClientRect();
        reviewPopover.style.top = `${window.scrollY + rect.bottom + 6}px`;
        reviewPopover.style.left = `${Math.max(8, Math.min(window.scrollX + rect.left, window.scrollX + document.documentElement.clientWidth - 360))}px`;
        reviewPopover.hidden = false;
    }

    root.addEventListener("click", (event) => {
        if (editing || !canReviewRole(readRole())) return;
        const block = event.target.closest(pendingSelector);
        if (block && root.contains(block) && !event.target.closest("a, button, input, select, textarea, summary")) {
            showReviewPopover(block);
        }
    });
    document.addEventListener("click", (event) => {
        if (!reviewPopover.hidden && !reviewPopover.contains(event.target) && !event.target.closest(pendingSelector)) {
            reviewPopover.hidden = true;
        }
    });
    renderReviewState();

    // Pages on the To Do list get a bar with a Resolve button ------------------------------------------------
    if (!isNewPage && /^page-/.test(currentPage)) {
        fetch(todoFile, { cache: "no-cache" }).then((response) => response.ok ? response.json() : {}).then((todo) => {
            const entry = (todo.pages || []).find((page) => page.file === currentPage && !page.resolved);
            if (!entry) return;
            const bar = document.createElement("div");
            bar.className = "wiki-todo-banner";
            bar.dataset.wikiInjected = "";
            bar.innerHTML = 'This page is marked incomplete and is on the <a href="todo.html">To Do list</a>. ';
            if (canReviewRole(readRole())) {
                const button = document.createElement("button");
                button.type = "button";
                button.className = "wiki-review-approve";
                button.textContent = "Resolve";
                button.addEventListener("click", async () => {
                    if (editing) {
                        status.textContent = "Save or cancel your edits before resolving this page.";
                        return;
                    }
                    if (!window.confirm(`Mark ${entry.title} as resolved? Its [UNRESOLVED] notes are removed from the page. [coming soon] notes stay.`)) return;
                    button.disabled = true;
                    try {
                        await window.wikiStore.resolveTodoPage(entry.file, entry.title);
                        savedContent = stripUnresolvedNotes(savedContent);
                        applyContent(savedContent);
                        bar.remove();
                        status.textContent = "Resolved. The live site usually updates within a minute or two.";
                    } catch (error) {
                        button.disabled = false;
                        status.textContent = `Could not resolve this page: ${error.message}`;
                    }
                });
                bar.append(button);
            }
            root.before(bar);
        }).catch(() => {
            // The bar is a convenience; the page still works without it.
        });
    }

    function setEditing(value) {
        editing = value;
        document.dispatchEvent(new Event("wiki-content-changed"));
        document.body.classList.toggle("wiki-editing", value);
        if (value) {
            root.contentEditable = "true";
            root.spellcheck = true;
            islands.forEach((island) => {
                island.contentEditable = "false";
            });
            markRawBlocks(true);
            document.execCommand("defaultParagraphSeparator", false, "p");
        } else {
            root.removeAttribute("contenteditable");
            root.removeAttribute("spellcheck");
            islands.forEach((island) => island.removeAttribute("contenteditable"));
            markRawBlocks(false);
            savedRange = null;
            buildTableOfContents();
        }
        formatBar.hidden = !value;
        (value ? formatBar : document.body).append(toolbar);
        editButton.disabled = value;
        saveButton.disabled = !value;
        cancelButton.disabled = !value;
        status.textContent = value
            ? "Edit the page, use the bar at the bottom for formatting, then save or cancel."
            : "";
    }

    // Long pages get an "On this page" list built from their headings.
    let toc = null;
    function buildTableOfContents() {
        const headings = [...root.querySelectorAll("h2, h3")].filter((heading) => heading.textContent.trim());
        if (headings.length < 3) {
            toc?.remove();
            toc = null;
            return;
        }
        if (!toc) {
            toc = document.createElement("details");
            toc.className = "wiki-toc";
            toc.open = window.innerWidth > 700;
            root.before(toc);
        }
        const list = document.createElement("ol");
        for (const heading of headings) {
            const item = document.createElement("li");
            item.className = heading.tagName === "H3" ? "wiki-toc-sub" : "";
            const link = document.createElement("button");
            link.type = "button";
            link.textContent = heading.textContent.trim();
            link.addEventListener("click", () => heading.scrollIntoView({ behavior: "smooth", block: "start" }));
            item.append(link);
            list.append(item);
        }
        const summary = document.createElement("summary");
        summary.textContent = "Contents";
        toc.replaceChildren(summary, list);
    }

    function saveEdits() {
        const content = serializeContent();
        try {
            localStorage.setItem(storageKey, JSON.stringify({ version: 2, html: content }));
        } catch (error) {
            status.textContent = `Could not save edits in this browser: ${error.message}`;
            return false;
        }

        savedContent = content;
        applyContent(content);
        setEditing(false);
        if (newPageFile) {
            const title = getCurrentTitle();
            document.title = `${title} | Strawberry MC`;
            saveLocalPage({ title, file: newPageFile, href: getDraftPageHref(newPageFile, title), keywords: getNewPageKeywords() });
        }
        status.textContent = "Edits saved in this browser. Commit to GitHub (or download the HTML) to update the site.";
        return true;
    }

    function isOwnResource(element, attribute) {
        try {
            return new URL(element.getAttribute(attribute), document.baseURI).origin === location.origin;
        } catch {
            return false;
        }
    }

    function isOwnHeadElement(element) {
        switch (element.tagName) {
            case "META":
                return element.hasAttribute("charset") || ["viewport", "description"].includes(element.getAttribute("name"));
            case "TITLE":
                return true;
            case "LINK":
                return element.getAttribute("rel") === "stylesheet" && isOwnResource(element, "href");
            case "SCRIPT":
                return element.hasAttribute("src") && isOwnResource(element, "src");
            default:
                return false;
        }
    }

    // Browser extensions add their own elements, styles and attributes to pages, so the saved file keeps
    // only the wiki's own parts: page metadata, the site header, the content and the wiki's scripts.
    function removeForeignParts(copy) {
        for (const child of [...copy.children]) {
            if (child.tagName !== "HEAD" && child.tagName !== "BODY") {
                child.remove();
            }
        }
        const head = copy.querySelector("head");
        const body = copy.querySelector("body");
        for (const child of [...head.children]) {
            if (!isOwnHeadElement(child)) {
                child.remove();
            }
        }
        for (const child of [...body.children]) {
            const isOwn = child.matches(".site-header, .wiki-content") ||
                (child.tagName === "SCRIPT" && child.hasAttribute("src") && isOwnResource(child, "src"));
            if (!isOwn) {
                child.remove();
            }
        }
        for (const child of [...(body.querySelector(".site-header")?.children || [])]) {
            if (child.tagName !== "NAV") {
                child.remove();
            }
        }
        const savedNav = body.querySelector(".site-header nav");
        if (savedNav && originalNavMarkup !== null) {
            savedNav.innerHTML = originalNavMarkup;
        }
        body.querySelectorAll("[data-wiki-injected]").forEach((element) => element.remove());
        for (const element of [copy, head, body]) {
            for (const { name } of [...element.attributes]) {
                if (!(element === copy && name === "lang")) {
                    element.removeAttribute(name);
                }
            }
        }
    }

    function buildPageHtml() {
        const copy = document.documentElement.cloneNode(true);
        removeForeignParts(copy);

        const template = document.createElement("template");
        template.innerHTML = savedContent;
        for (const placeholder of template.content.querySelectorAll("span[data-wiki-island]")) {
            const original = document.createElement("template");
            original.innerHTML = islandMarkup[Number(placeholder.dataset.wikiIsland)];
            placeholder.replaceWith(original.content);
        }
        copy.querySelector(".wiki-content").replaceWith(template.content);

        const doctype = document.doctype
            ? `<!DOCTYPE ${document.doctype.name}>`
            : "<!DOCTYPE html>";
        return `${doctype}\n${copy.outerHTML}\n`;
    }

    function downloadPage() {
        const blob = new Blob([buildPageHtml()], { type: "text/html;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = targetFile;
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        status.textContent = "Downloaded an HTML copy of this page.";
    }

    // Search matches every typed word against "title + keywords", so store keywords as lowercase words split by spaces.
    function normalizeKeywords(text) {
        return [...new Set(text.toLowerCase().split(/[\s,]+/).filter(Boolean))].join(" ");
    }

    // A page made on the website keeps its new-page address after the first commit; later commits update it.
    function isPublishedNewPage() {
        return Boolean(readLocalPages().find((page) => page.file === newPageFile)?.published);
    }

    function getNewPageKeywords() {
        const entry = readLocalPages().find((page) => page.file === newPageFile);
        return entry && typeof entry.keywords === "string" && entry.keywords
            ? entry.keywords
            : normalizeKeywords(getCurrentTitle());
    }

    // Dialogs ------------------------------------------------------------------

    function createDialog(markup) {
        const dialog = document.createElement("dialog");
        dialog.className = "wiki-dialog";
        dialog.innerHTML = markup;
        document.body.append(dialog);
        dialog.querySelector('[value="cancel"]').addEventListener("click", (event) => {
            event.preventDefault();
            dialog.close();
        });
        return dialog;
    }

    function slugPart(text) {
        return text
            .toLowerCase()
            .normalize("NFKD")
            .replace(/[̀-ͯ]/g, "")
            .replace(/['’]/g, "")
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "");
    }

    function slugify(title) {
        const slug = slugPart(title);
        return slug ? `page-${slug}.html` : "";
    }

    // Articles are namespaced by author: news-<author>-<title>.html
    function newsFileName(author, title) {
        const authorSlug = slugPart(author);
        const titleSlug = slugPart(title);
        return authorSlug && titleSlug ? `news-${authorSlug}-${titleSlug}.html` : "";
    }

    const newPageDialog = createDialog(`
        <form method="dialog">
            <h2 class="wiki-new-page-heading">Create a new page</h2>
            <label for="wiki-new-page-title" class="wiki-new-page-title-label">Page title</label>
            <input id="wiki-new-page-title" name="title" required maxlength="80" autocomplete="off">
            <div class="wiki-article-fields" hidden>
                <label for="wiki-new-page-author">Author</label>
                <input id="wiki-new-page-author" name="author" maxlength="60" autocomplete="name">
                <label for="wiki-new-page-summary">Summary</label>
                <textarea id="wiki-new-page-summary" name="summary" rows="2" maxlength="300"></textarea>
                <p class="wiki-dialog-hint">One or two sentences shown on the News page.</p>
            </div>
            <p class="wiki-dialog-hint">File name: <code class="consolas wiki-new-page-file">—</code></p>
            <label for="wiki-new-page-keywords">Search keywords</label>
            <textarea id="wiki-new-page-keywords" name="keywords" rows="3" autocomplete="off"></textarea>
            <p class="wiki-dialog-hint">Every word that should lead to this page in search, separated by spaces or commas.</p>
            <p class="wiki-dialog-error" role="alert"></p>
            <div class="wiki-dialog-actions">
                <button type="button" value="cancel">Cancel</button>
                <button type="submit" class="wiki-primary">Create page</button>
            </div>
        </form>
    `);
    const newPageTitleInput = newPageDialog.querySelector("#wiki-new-page-title");
    const newPageAuthorInput = newPageDialog.querySelector("#wiki-new-page-author");
    const newPageSummaryInput = newPageDialog.querySelector("#wiki-new-page-summary");
    const newPageKeywordsInput = newPageDialog.querySelector("#wiki-new-page-keywords");
    const articleFields = newPageDialog.querySelector(".wiki-article-fields");
    let keywordsEdited = false;
    let newPageKind = "page";
    const newPageFileLabel = newPageDialog.querySelector(".wiki-new-page-file");
    const newPageError = newPageDialog.querySelector(".wiki-dialog-error");

    function dialogFileName() {
        return newPageKind === "news"
            ? newsFileName(newPageAuthorInput.value, newPageTitleInput.value)
            : slugify(newPageTitleInput.value);
    }

    function openNewPageDialog(kind = "page") {
        newPageKind = kind;
        const isArticle = kind === "news";
        newPageDialog.querySelector(".wiki-new-page-heading").textContent = isArticle ? "Write a news article" : "Create a new page";
        newPageDialog.querySelector(".wiki-new-page-title-label").textContent = isArticle ? "Article title" : "Page title";
        newPageDialog.querySelector('button[type="submit"]').textContent = isArticle ? "Start writing" : "Create page";
        articleFields.hidden = !isArticle;
        newPageAuthorInput.required = isArticle;
        try {
            newPageAuthorInput.value = localStorage.getItem(authorStorageKey) || "";
        } catch {
            newPageAuthorInput.value = "";
        }
        newPageTitleInput.value = "";
        newPageSummaryInput.value = "";
        newPageKeywordsInput.value = "";
        keywordsEdited = false;
        newPageFileLabel.textContent = "—";
        newPageError.textContent = "";
        newPageDialog.showModal();
        newPageTitleInput.focus();
    }

    for (const input of [newPageTitleInput, newPageAuthorInput]) {
        input.addEventListener("input", () => {
            newPageFileLabel.textContent = dialogFileName() || "—";
            newPageError.textContent = "";
        });
    }

    newPageTitleInput.addEventListener("input", () => {
        // Keywords start as the page name and follow the title until they are edited by hand.
        if (!keywordsEdited) {
            newPageKeywordsInput.value = normalizeKeywords(newPageTitleInput.value);
        }
    });

    newPageKeywordsInput.addEventListener("input", () => {
        keywordsEdited = true;
    });

    newPageDialog.querySelector("form").addEventListener("submit", async (event) => {
        event.preventDefault();
        if (readRole() === "reviewer" && !draftPrefix.test(newPageTitleInput.value.trim())) {
            newPageTitleInput.value = `[draft] ${newPageTitleInput.value.trim()}`;
        }
        const title = newPageTitleInput.value.trim();
        const author = newPageAuthorInput.value.trim();
        const file = dialogFileName();
        if (!file) {
            newPageError.textContent = newPageKind === "news"
                ? "Use at least one letter or number in both the title and the author name."
                : "Use at least one letter or number in the title.";
            return;
        }
        if (!readLocalPages().some((page) => page.file === file)) {
            try {
                const response = await fetch(file, { method: "HEAD", cache: "no-store" });
                if (response.ok) {
                    newPageError.textContent = `A page called ${file} already exists. Choose a different title.`;
                    return;
                }
            } catch {
                // Opened from disk (file://), so the check is skipped; committing still refuses to overwrite.
            }
        }
        const keywords = normalizeKeywords(newPageKeywordsInput.value) || normalizeKeywords(title);
        const entry = { title, file, href: getDraftPageHref(file, title), keywords };
        if (newPageKind === "news") {
            Object.assign(entry, { kind: "news", author, date: todayString(), summary: newPageSummaryInput.value.trim() });
            try {
                localStorage.setItem(authorStorageKey, author);
            } catch {
                // The author name just won't be prefilled next time.
            }
        }
        saveLocalPage(entry);
        location.href = getDraftPageHref(file, title);
    });

    const commitDialog = createDialog(`
        <form method="dialog">
            <h2>Commit to GitHub</h2>
            <p class="wiki-dialog-hint">Saves <code class="consolas wiki-commit-file"></code> to
                <strong>${repository.owner}/${repository.name}</strong> on the <strong>${repository.branch}</strong> branch.</p>
            <label for="wiki-commit-message">Commit message</label>
            <input id="wiki-commit-message" name="message" required maxlength="120" autocomplete="off">
            <div class="wiki-keywords-field" hidden>
                <label for="wiki-commit-keywords">Search keywords</label>
                <textarea id="wiki-commit-keywords" name="keywords" rows="3" autocomplete="off"></textarea>
                <p class="wiki-dialog-hint">Every word that should lead to this page in search, separated by spaces or commas.</p>
            </div>
            <div class="wiki-password-field" hidden>
                <label for="wiki-commit-password">Wiki password</label>
                <input id="wiki-commit-password" name="password" type="password" autocomplete="current-password">
                <p class="wiki-dialog-hint">Ask the wiki owner for the editing password.
                    <button type="button" class="wiki-link-button" data-action="use-own-token">Use my own GitHub token instead</button></p>
                <label class="wiki-checkbox"><input type="checkbox" name="rememberPassword" checked> Stay unlocked until this tab is closed</label>
            </div>
            <div class="wiki-token-field">
                <label for="wiki-commit-token">GitHub token</label>
                <input id="wiki-commit-token" name="token" type="password" autocomplete="off" spellcheck="false">
                <p class="wiki-dialog-hint">Create a <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">fine-grained token</a>
                    for only this repository with <strong>Contents: Read and write</strong> permission.</p>
                <label class="wiki-checkbox"><input type="checkbox" name="remember" checked> Remember until this tab is closed</label>
                <p class="wiki-dialog-hint"><button type="button" class="wiki-link-button" data-action="setup-shared-token">Set up a wiki password so editors don't need their own token</button></p>
            </div>
            <p class="wiki-token-saved" hidden>Using the GitHub token saved for this tab.
                <button type="button" class="wiki-link-button" data-action="forget-token">Forget token</button></p>
            <p class="wiki-dialog-error" role="alert"></p>
            <div class="wiki-dialog-actions">
                <button type="button" value="cancel">Cancel</button>
                <button type="submit" class="wiki-primary">Commit</button>
            </div>
        </form>
    `);
    const commitForm = commitDialog.querySelector("form");
    const commitError = commitDialog.querySelector(".wiki-dialog-error");
    const tokenField = commitDialog.querySelector(".wiki-token-field");
    const tokenInput = commitDialog.querySelector("#wiki-commit-token");
    const tokenSaved = commitDialog.querySelector(".wiki-token-saved");
    const commitSubmit = commitDialog.querySelector('button[type="submit"]');
    const commitKeywordsField = commitDialog.querySelector(".wiki-keywords-field");
    const commitKeywordsInput = commitDialog.querySelector("#wiki-commit-keywords");

    function readToken() {
        try {
            return sessionStorage.getItem(tokenStorageKey) || localStorage.getItem(tokenStorageKey);
        } catch {
            return null;
        }
    }

    // Forget the unlocked token in this tab and on this device ("Remember me").
    function forgetToken() {
        for (const storage of [sessionStorage, localStorage]) {
            try {
                storage.removeItem(tokenStorageKey);
            } catch {
                // Storage blocked; nothing was saved there.
            }
        }
    }

    const passwordField = commitDialog.querySelector(".wiki-password-field");
    const passwordInput = commitDialog.querySelector("#wiki-commit-password");
    let sharedToken = null;
    let useOwnToken = false;

    function showTokenState() {
        const hasToken = Boolean(readToken());
        const usePassword = !hasToken && Boolean(sharedToken) && !useOwnToken;
        passwordField.hidden = !usePassword;
        passwordInput.required = usePassword;
        tokenField.hidden = hasToken || usePassword;
        tokenInput.required = !hasToken && !usePassword;
        tokenSaved.hidden = !hasToken;
    }

    // Shared token --------------------------------------------------------------
    // The owner's token is stored in the repository encrypted with AES-GCM, using a key derived from
    // the wiki password with PBKDF2. Anyone can download the encrypted file, so the password must be long.

    const kdfIterations = 600000;

    function bytesToBase64(bytes) {
        return btoa(String.fromCharCode(...bytes));
    }

    function base64ToBytes(text) {
        return Uint8Array.from(atob(text), (character) => character.charCodeAt(0));
    }

    async function deriveKey(password, salt, iterations) {
        const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
        return crypto.subtle.deriveKey(
            { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
            material,
            { name: "AES-GCM", length: 256 },
            false,
            ["encrypt", "decrypt"]
        );
    }

    async function encryptToken(token, password) {
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const key = await deriveKey(password, salt, kdfIterations);
        const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(token)));
        return {
            version: 1,
            cipher: "AES-GCM-256",
            kdf: "PBKDF2-SHA256",
            iterations: kdfIterations,
            salt: bytesToBase64(salt),
            iv: bytesToBase64(iv),
            ciphertext: bytesToBase64(ciphertext)
        };
    }

    async function decryptToken(stored, password) {
        const key = await deriveKey(password, base64ToBytes(stored.salt), stored.iterations);
        try {
            const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(stored.iv) }, key, base64ToBytes(stored.ciphertext));
            return new TextDecoder().decode(plaintext);
        } catch {
            throw new Error("That wiki password is not correct.");
        }
    }

    function isSharedToken(value) {
        return Boolean(value) && value.version === 1 && Number.isInteger(value.iterations) &&
            ["salt", "iv", "ciphertext"].every((field) => typeof value[field] === "string");
    }

    async function loadSharedToken() {
        try {
            const response = await fetch(sharedTokenFile, { cache: "no-store" });
            if (response.ok) {
                const parsed = await response.json();
                return isSharedToken(parsed) ? parsed : null;
            }
        } catch {
            // Fall through to the repository, which has it before the live site finishes updating.
        }
        try {
            const response = await fetch(`https://api.github.com/repos/${repository.owner}/${repository.name}/contents/${sharedTokenFile}?ref=${repository.branch}`, {
                cache: "no-store",
                headers: { Accept: "application/vnd.github.raw+json" }
            });
            if (response.ok) {
                const parsed = await response.json();
                return isSharedToken(parsed) ? parsed : null;
            }
        } catch {
            // No shared token available; editors use their own token.
        }
        return null;
    }

    commitDialog.querySelector('[data-action="forget-token"]').addEventListener("click", () => {
        try {
            forgetToken();
        } catch {
            // Nothing stored.
        }
        showTokenState();
        (passwordField.hidden ? tokenInput : passwordInput).focus();
    });

    commitDialog.querySelector('[data-action="use-own-token"]').addEventListener("click", () => {
        useOwnToken = true;
        showTokenState();
        tokenInput.focus();
    });

    const setupDialog = createDialog(`
        <form method="dialog">
            <h2>Set up a wiki password</h2>
            <p class="wiki-dialog-hint">Your GitHub token is encrypted with this password and saved in the repository as
                <code class="consolas">${sharedTokenFile}</code>. Editors then type the password instead of a token.</p>
            <label for="wiki-setup-token">Your GitHub token</label>
            <input id="wiki-setup-token" name="token" type="password" required autocomplete="off" spellcheck="false">
            <label for="wiki-setup-password">New wiki password</label>
            <input id="wiki-setup-password" name="password" type="password" required minlength="12" autocomplete="new-password">
            <label for="wiki-setup-confirm">Type the password again</label>
            <input id="wiki-setup-confirm" name="confirm" type="password" required minlength="12" autocomplete="new-password">
            <p class="wiki-dialog-hint"><strong>Use a long password</strong>: at least 12 characters, ideally four or more random words.
                The encrypted file is public, so a short password can be guessed. Anyone who knows it can change the wiki.</p>
            <p class="wiki-dialog-error" role="alert"></p>
            <div class="wiki-dialog-actions">
                <button type="button" value="cancel">Cancel</button>
                <button type="submit" class="wiki-primary">Save wiki password</button>
            </div>
        </form>
    `);
    const setupForm = setupDialog.querySelector("form");
    const setupError = setupDialog.querySelector(".wiki-dialog-error");
    const setupSubmit = setupDialog.querySelector('button[type="submit"]');

    commitDialog.querySelector('[data-action="setup-shared-token"]').addEventListener("click", () => {
        setupForm.reset();
        setupDialog.querySelector("#wiki-setup-token").value = tokenInput.value;
        setupError.textContent = "";
        commitDialog.close();
        setupDialog.showModal();
    });

    setupForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const formData = new FormData(setupForm);
        const token = String(formData.get("token")).trim();
        const password = String(formData.get("password"));
        if (password !== formData.get("confirm")) {
            setupError.textContent = "The two passwords don't match.";
            return;
        }

        setupSubmit.disabled = true;
        setupSubmit.textContent = "Saving…";
        setupError.textContent = "";
        try {
            // Reading the file first also checks that the token works.
            const existing = await getRepositoryFile(token, sharedTokenFile);
            const encrypted = await encryptToken(token, password);
            await putRepositoryFile(token, sharedTokenFile, `${JSON.stringify(encrypted, null, 2)}\n`,
                existing ? "Update encrypted wiki token" : "Add encrypted wiki token", existing?.sha);
            sharedToken = encrypted;
            try {
                sessionStorage.setItem(tokenStorageKey, token);
            } catch {
                // This tab will ask for the password next time.
            }
            setupDialog.close();
            openCommitDialog();
            status.textContent = "Wiki password saved. Editors can now commit with the password.";
        } catch (error) {
            setupError.textContent = error.message;
        } finally {
            setupSubmit.disabled = false;
            setupSubmit.textContent = "Save wiki password";
        }
    });

    function openCommitDialog() {
        if (editing && !saveEdits()) {
            return;
        }
        commitDialog.querySelector(".wiki-commit-file").textContent = targetFile;
        commitDialog.querySelector("#wiki-commit-message").value = isNewsArticle
            ? `Publish news article: ${getCurrentTitle()}`
            : newPageFile && !isPublishedNewPage()
                ? `Create ${getCurrentTitle()} page`
                : `Update ${getCurrentTitle()} page`;
        commitKeywordsField.hidden = !newPageFile || isPublishedNewPage();
        if (newPageFile) {
            commitKeywordsInput.value = getNewPageKeywords();
        }
        tokenInput.value = "";
        passwordInput.value = "";
        useOwnToken = false;
        commitError.textContent = "";
        commitSubmit.disabled = false;
        showTokenState();
        commitDialog.showModal();
        loadSharedToken().then((stored) => {
            sharedToken = stored;
            showTokenState();
        });
    }

    class GitHubError extends Error {
        constructor(status, detail) {
            const messages = {
                401: "GitHub rejected the token. Check that it was copied correctly and has not expired.",
                403: "The token does not have permission to write to this repository.",
                404: "The repository was not found, or the token cannot access it.",
                409: "The file changed on GitHub while you were editing. Reload the page and try again.",
                422: "GitHub could not accept this change."
            };
            super(`${messages[status] || `GitHub returned an error (${status}).`}${detail ? ` (${detail})` : ""}`);
            this.status = status;
        }
    }

    async function githubRequest(token, path, { method = "GET", body, allowMissing = false } = {}) {
        const response = await fetch(`https://api.github.com/repos/${repository.owner}/${repository.name}/${path}`, {
            method,
            cache: "no-store",
            headers: {
                Accept: "application/vnd.github+json",
                Authorization: `Bearer ${token}`,
                "X-GitHub-Api-Version": "2022-11-28",
                ...(body ? { "Content-Type": "application/json" } : {})
            },
            body: body ? JSON.stringify(body) : undefined
        });
        if (response.status === 404 && allowMissing) {
            return null;
        }
        if (!response.ok) {
            let detail = "";
            try {
                detail = (await response.json()).message;
            } catch {
                // No JSON error body.
            }
            throw new GitHubError(response.status, detail);
        }
        return response.json();
    }

    function encodeBase64(text) {
        const bytes = new TextEncoder().encode(text);
        let binary = "";
        for (let index = 0; index < bytes.length; index += 0x8000) {
            binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
        }
        return btoa(binary);
    }

    function decodeBase64(encoded) {
        const binary = atob(encoded.replace(/\s/g, ""));
        return new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
    }

    async function getRepositoryFile(token, file) {
        const data = await githubRequest(token, `contents/${encodeURIComponent(file)}?ref=${repository.branch}`, { allowMissing: true });
        return data && { sha: data.sha, text: decodeBase64(data.content) };
    }

    function putRepositoryFile(token, file, text, message, sha) {
        return githubRequest(token, `contents/${encodeURIComponent(file)}`, {
            method: "PUT",
            body: { message, content: encodeBase64(text), branch: repository.branch, ...(sha ? { sha } : {}) }
        });
    }

    async function addToSearchIndex(token, title, file, keywords) {
        const searchFile = await getRepositoryFile(token, "search.js");
        if (!searchFile) {
            throw new Error("search.js was not found in the repository.");
        }
        if (searchFile.text.includes(`href: ${JSON.stringify(file)}`)) {
            return;
        }
        const listEnd = searchFile.text.indexOf("\n];");
        if (listEnd === -1) {
            throw new Error("Could not find the page list in search.js.");
        }
        const newline = searchFile.text.includes("\r\n") ? "\r\n" : "\n";
        const before = searchFile.text.slice(0, listEnd).trimEnd();
        const entry = `    { title: ${JSON.stringify(title)}, href: ${JSON.stringify(file)}, keywords: ${JSON.stringify(keywords)} },`;
        const updated = `${before.endsWith(",") ? before : `${before},`}${newline}${entry}${newline}${searchFile.text.slice(listEnd + 1)}`;
        await putRepositoryFile(token, "search.js", updated, `Add ${title} to search`, searchFile.sha);
    }

    async function addToNewsIndex(token, article) {
        const newsFile = await getRepositoryFile(token, "news.js");
        if (!newsFile) {
            throw new Error("news.js was not found in the repository.");
        }
        if (newsFile.text.includes(`href: ${JSON.stringify(article.href)}`)) {
            return;
        }
        const marker = "const newsArticles = [";
        const listStart = newsFile.text.indexOf(marker);
        if (listStart === -1) {
            throw new Error("Could not find the article list in news.js.");
        }
        // Newest articles go first.
        const newline = newsFile.text.includes("\r\n") ? "\r\n" : "\n";
        const insertAt = listStart + marker.length;
        const fields = ["title", "author", "date", "href", "summary"].map((field) => `${field}: ${JSON.stringify(article[field])}`).join(", ");
        const updated = `${newsFile.text.slice(0, insertAt)}${newline}    { ${fields} },${newsFile.text.slice(insertAt)}`;
        await putRepositoryFile(token, "news.js", updated, `Add ${article.title} to news`, newsFile.sha);
    }

    commitForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const formData = new FormData(commitForm);
        let message = String(formData.get("message")).trim();
        const usingPassword = !passwordField.hidden;
        if (usingPassword ? !formData.get("password") : !readToken() && !String(formData.get("token")).trim()) {
            commitError.textContent = usingPassword ? "Enter the wiki password." : "Enter a GitHub token.";
            return;
        }

        commitSubmit.disabled = true;
        commitError.textContent = "";
        commitSubmit.textContent = usingPassword ? "Unlocking…" : "Committing…";
        let token;
        try {
            token = readToken() || (usingPassword
                ? await decryptToken(sharedToken, String(formData.get("password")))
                : String(formData.get("token")).trim());
        } catch (error) {
            commitError.textContent = error.message;
            commitSubmit.disabled = false;
            commitSubmit.textContent = "Commit";
            return;
        }
        commitSubmit.textContent = "Committing…";
        const title = getCurrentTitle();
        const keywords = normalizeKeywords(String(formData.get("keywords") || "")) || normalizeKeywords(title);
        if (newPageFile) {
            saveLocalPage({ title, file: newPageFile, href: getDraftPageHref(newPageFile, title), keywords });
        }
        try {
            // Signed-in reviewers' edits are saved as pending changes for an admin to review
            const role = readAccount() && readToken() ? await checkAccount(token) : "";
            if (role === "reviewer") {
                savedContent = markPendingChanges(originalContent, savedContent, readAccount());
                applyContent(savedContent);
                renderReviewState();
                if (!message.endsWith("(needs review)")) message += " (needs review)";
            }
            const existing = await getRepositoryFile(token, targetFile);
            // Pages committed before this browser remembered publishing them land here too, so ask rather than refuse.
            if (newPageFile && existing && !isPublishedNewPage() &&
                (role === "reviewer" || !window.confirm(`${targetFile} already exists on GitHub. Replace it with this version?`))) {
                throw new Error(`${targetFile} already exists on GitHub. Open that page and edit it there, or create this one with a different title.`);
            }
            // The repository stores pages with Windows (CRLF) line endings; match it so diffs only show real changes.
            const pageHtml = buildPageHtml().replace(/\r?\n/g, !existing || existing.text.includes("\r\n") ? "\r\n" : "\n");
            await putRepositoryFile(token, targetFile, pageHtml, message, existing?.sha);
            if (role === "reviewer") {
                await updatePendingPages(token, (pages) => {
                    pages[targetFile] = { title, by: readAccount(), date: new Date().toISOString() };
                }, `Update review queue for ${title} page`);
            }
            if (!readToken() && formData.get(usingPassword ? "rememberPassword" : "remember")) {
                try {
                    sessionStorage.setItem(tokenStorageKey, token);
                } catch {
                    // The token just won't be remembered.
                }
            }

            let searchNote = "";
            if (newPageFile && !existing) {
                try {
                    await addToSearchIndex(token, title, newPageFile, keywords);
                } catch (error) {
                    searchNote = ` The page was committed, but adding it to search failed: ${error.message}`;
                }
                if (isNewsArticle) {
                    const article = readLocalPages().find((page) => page.file === newPageFile);
                    try {
                        await addToNewsIndex(token, {
                            title,
                            author: article?.author || "",
                            date: article?.date || todayString(),
                            href: newPageFile,
                            summary: article?.summary || ""
                        });
                    } catch (error) {
                        searchNote += ` The article was committed, but adding it to the News page failed: ${error.message}`;
                    }
                }
            }
            if (newPageFile) {
                saveLocalPage({ title, file: newPageFile, href: newPageFile, keywords, published: true });
            }
            try {
                localStorage.removeItem(storageKey);
            } catch {
                // The draft simply stays in this browser.
            }

            commitDialog.close();
            status.textContent = "";
            status.append(`Committed ${targetFile} to GitHub. The live site usually updates within a minute or two.${searchNote} `);
            if (newPageFile) {
                const link = document.createElement("a");
                link.href = newPageFile;
                link.textContent = isNewsArticle ? "Open the article" : "Open the new page";
                status.append(link);
            }
        } catch (error) {
            if (error instanceof GitHubError && error.status === 401) {
                try {
                    forgetToken();
                } catch {
                    // Nothing stored.
                }
                showTokenState();
            }
            commitError.textContent = usingPassword && error instanceof GitHubError && [401, 403].includes(error.status)
                ? "The wiki password worked, but the saved GitHub token has expired or lost access. The wiki owner needs to set up the wiki password again with a new token."
                : error.message;
        } finally {
            commitSubmit.disabled = false;
            commitSubmit.textContent = "Commit";
        }
    });

    // Toolbar wiring ---------------------------------------------------------

    editButton.addEventListener("click", () => {
        setEditing(true);
        root.focus();
    });
    saveButton.addEventListener("click", saveEdits);
    cancelButton.addEventListener("click", () => {
        applyContent(savedContent);
        setEditing(false);
        status.textContent = "Unsaved edits discarded.";
    });
    commitButton.addEventListener("click", openCommitDialog);

    downloadButton.addEventListener("click", () => {
        if (!editing || saveEdits()) {
            downloadPage();
        }
    });

    resetButton.addEventListener("click", () => {
        if (!window.confirm("Remove saved browser edits and restore this page to its original text?")) {
            return;
        }
        try {
            localStorage.removeItem(storageKey);
        } catch (error) {
            status.textContent = `Could not clear saved edits: ${error.message}`;
            return;
        }
        savedContent = originalContent;
        applyContent(savedContent);
        setEditing(false);
        status.textContent = "Saved edits removed; original page text restored.";
    });

    window.addEventListener("beforeunload", (event) => {
        if (editing && serializeContent() !== savedContent) {
            event.preventDefault();
        }
    });

    let hasDraft = false;
    try {
        const serialized = localStorage.getItem(storageKey);
        if (serialized !== null) {
            const parsed = JSON.parse(serialized);
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
                throw new Error("Saved edits have an invalid format.");
            }
            if (typeof parsed.html === "string") {
                applyContent(sanitizeMarkup(parsed.html));
            } else {
                applyLegacyDraft(parsed);
            }
            savedContent = serializeContent();
            hasDraft = true;
            status.textContent = "Saved browser edits are applied.";
        }
    } catch (error) {
        savedContent = originalContent;
        applyContent(savedContent);
        status.textContent = `Could not load saved edits: ${error.message}`;
    }

    setEditing(false);

    if (isNewPage && !newPageFile) {
        [editButton, commitButton, downloadButton, resetButton].forEach((button) => {
            button.disabled = true;
        });
        status.textContent = "Choose a title to start a new page.";
        openNewPageDialog();
    } else if (newPageFile) {
        if (hasDraft) {
            const title = getCurrentTitle();
            document.title = `${title} | Strawberry MC`;
        }
        setEditing(true);
        status.textContent = isNewsArticle
            ? `New article ${newPageFile}: write it, then save and commit it to GitHub to publish it on the News page.`
            : `New page ${newPageFile}: write your content, then save and commit it to GitHub.`;
    }

    // GitHub Pages lets browsers reuse files for 10 minutes, so after a site update readers can see an old copy.
    // Ask the server whether this page or its styles and scripts changed, and reload once with the new copies.
    async function refreshIfSiteUpdated() {
        const reloadKey = "strawberry-wiki-refreshed-at";
        if (Date.now() - Number(sessionStorage.getItem(reloadKey) || 0) < 60000) {
            return;
        }
        const urls = [location.href.split("#")[0], ...[...document.querySelectorAll('link[rel="stylesheet"][href], script[src]')].map((element) => element.href || element.src)]
            .filter((url) => new URL(url).origin === location.origin);
        const readText = (url, cache) => fetch(url, { cache }).then((response) => response.ok ? response.text() : null);
        const changed = await Promise.all([...new Set(urls)].map(async (url) => {
            const cached = await readText(url, "force-cache");
            const fresh = await readText(url, "no-cache");
            return cached !== null && fresh !== null && cached !== fresh;
        }));
        if (changed.some(Boolean) && !editing && !document.querySelector("dialog[open]")) {
            sessionStorage.setItem(reloadKey, String(Date.now()));
            location.reload();
        }
    }
    refreshIfSiteUpdated().catch(() => {
        // Keep showing the copy we have if the check fails (for example when offline).
    });

    // Ctrl+S / Cmd+S saves while editing instead of downloading the page.
    document.addEventListener("keydown", (event) => {
        if (editing && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
            event.preventDefault();
            saveEdits();
        }
    });

    // A button to jump back up appears once the reader has scrolled down a long page.
    const backToTop = document.createElement("button");
    backToTop.type = "button";
    backToTop.className = "wiki-back-to-top";
    backToTop.textContent = "↑ Top";
    backToTop.title = "Back to the top of the page";
    backToTop.hidden = true;
    backToTop.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
    document.body.append(backToTop);
    window.addEventListener("scroll", () => {
        backToTop.hidden = window.scrollY < 600;
    }, { passive: true });

    document.querySelector("#new-article-button")?.addEventListener("click", () => openNewPageDialog("news"));

    // Shared data store for interactive pages (Ideas, Threads & Debates, Bug Tracker). Writes need a wiki account.
    // The wiki password (admins and editors) or the review password (reviewers) unlocks the shared GitHub token, and
    // a personal password, checked against accounts.json, proves who you are. Reviewers' changes are saved marked
    // as pending until an admin approves them. All of this runs in the browser, so it guides honest editors rather
    // than locking anyone out: whoever can unlock the token could change the files directly.
    const accountsFile = "accounts.json";
    const reviewTokenFile = "wiki-token-review.json";
    const accountIterations = 310000;
    const roles = ["admin", "editor", "reviewer"];

    function readSession(key) {
        try {
            return sessionStorage.getItem(key) || localStorage.getItem(key) || "";
        } catch {
            return "";
        }
    }

    function readAccount() {
        return readSession(accountStorageKey);
    }

    function readRole() {
        return readToken() && readAccount() ? readSession(roleStorageKey) || "editor" : "";
    }

    function forgetAccount() {
        for (const storage of [sessionStorage, localStorage]) {
            try {
                storage.removeItem(accountStorageKey);
                storage.removeItem(roleStorageKey);
            } catch {
                // Storage blocked; nothing was saved there.
            }
        }
    }

    // Keeps the role next to wherever the sign-in was saved
    function storeRole(role) {
        for (const storage of [sessionStorage, localStorage]) {
            try {
                if (storage.getItem(accountStorageKey)) {
                    storage.setItem(roleStorageKey, role);
                }
            } catch {
                // Storage blocked; the role is checked again on the next save.
            }
        }
    }

    async function hashPersonalPassword(password, salt, iterations) {
        const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
        const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations, hash: "SHA-256" }, material, 256);
        return bytesToBase64(new Uint8Array(bits));
    }

    function accountKey(name) {
        return name.trim().toLowerCase();
    }

    async function loadReviewToken() {
        try {
            const response = await fetch(reviewTokenFile, { cache: "no-store" });
            return response.ok ? await response.json() : null;
        } catch {
            return null;
        }
    }

    // The wiki password gives an admin or editor session, the review password a reviewer session
    async function unlockEither(password) {
        sharedToken = sharedToken || await loadSharedToken();
        if (!sharedToken) {
            throw new Error("The wiki password has not been set up yet.");
        }
        try {
            return { token: await decryptToken(sharedToken, password), kind: "wiki" };
        } catch {
            const reviewToken = await loadReviewToken();
            if (reviewToken) {
                try {
                    return { token: await decryptToken(reviewToken, password), kind: "review" };
                } catch {
                    // Neither password matched.
                }
            }
            throw new Error("That isn't the wiki password or the review password.");
        }
    }

    function blockedMessage(account) {
        return account.blockedUntil && Date.parse(account.blockedUntil) > Date.now()
            ? `${account.name} is blocked until ${new Date(account.blockedUntil).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}.`
            : "";
    }

    async function readAccounts(token) {
        return JSON.parse((await getRepositoryFile(token, accountsFile))?.text || "{}");
    }

    // Read and change a JSON file in the repository, retrying if someone else saved first.
    async function updateRepositoryJson(token, file, change, message) {
        for (let attempt = 0; ; attempt++) {
            const current = await getRepositoryFile(token, file);
            const data = current ? JSON.parse(current.text) : {};
            // A change that returns false found nothing to do, so nothing is committed.
            if (change(data) === false) {
                return data;
            }
            const text = `${JSON.stringify(data, null, 1)}\n`;
            try {
                await putRepositoryFile(token, file, text, message, current?.sha);
                jsonSaves++;
                return data;
            } catch (error) {
                if (error.status === 401 || error.status === 403) {
                    forgetToken();
                    forgetAccount();
                }
                if (!(error.status === 409 || error.status === 422) || attempt >= 3) {
                    throw error;
                }
            }
        }
    }

    // Before every save, check the account still exists, isn't blocked, and pick up role changes
    async function checkAccount(token) {
        const account = (await readAccounts(token)).accounts?.[accountKey(readAccount())];
        if (!account) {
            forgetToken();
            forgetAccount();
            throw new Error("Your account no longer exists. Log in again.");
        }
        const blocked = blockedMessage(account);
        if (blocked) {
            throw new Error(blocked);
        }
        storeRole(account.role || "editor");
        return account.role || "editor";
    }

    function rememberSignIn(token, name, role, remember) {
        forgetToken();
        forgetAccount();
        try {
            const storage = remember ? localStorage : sessionStorage;
            storage.setItem(tokenStorageKey, token);
            storage.setItem(accountStorageKey, name);
            storage.setItem(roleStorageKey, role);
            localStorage.setItem(authorStorageKey, name);
        } catch {
            // Not remembered; sign in again next time.
        }
    }

    function canReviewRole(role) {
        return role === "admin" || role === "editor";
    }

    // Saves already on their way; pressing a button twice while one is loading shouldn't post twice.
    const savesInFlight = new Map();

    function requireAdmin() {
        if (readRole() !== "admin") {
            throw new Error("Only admins can do that.");
        }
        return readToken();
    }

    // Comments that name this person with @ and aren't marked done yet
    function annotationTasks(data, name) {
        const key = accountKey(name);
        return (data.annotations || []).filter((annotation) => !annotation.pending).flatMap((annotation) =>
            [annotation, ...(annotation.replies || [])]
                .filter((item) => !item.pending && (item.mentions || []).some((mention) => accountKey(mention) === key) && !item.done?.[key])
                .map((item) => ({ annotation, item })));
    }

    // Live updates -------------------------------------------------------------------------------
    // The published site can be minutes behind, so signed-in people ask GitHub directly. Asking with the
    // file's ETag answers "304 nothing new", which GitHub doesn't count against the token's limit.
    const signedInDelay = 4000;
    const signedOutDelay = 20000;
    const limitedDelay = 60000;
    const watchers = new Map();
    let jsonSaves = 0;

    async function readLatestJson(file, watcher) {
        const token = readToken();
        if (!token) {
            const response = await fetch(file, { cache: "no-cache" });
            return response.ok ? response.text() : null;
        }
        const response = await fetch(`https://api.github.com/repos/${repository.owner}/${repository.name}/contents/${encodeURIComponent(file)}?ref=${repository.branch}`, {
            cache: "no-store",
            headers: {
                Accept: "application/vnd.github+json",
                Authorization: `Bearer ${token}`,
                "X-GitHub-Api-Version": "2022-11-28",
                ...(watcher.etag ? { "If-None-Match": watcher.etag } : {})
            }
        });
        if (response.status === 304 || response.status === 404) {
            return null;
        }
        if (!response.ok) {
            throw new GitHubError(response.status, "");
        }
        watcher.etag = response.headers.get("ETag") || "";
        const body = await response.json();
        return body.content ? decodeBase64(body.content) : null;
    }

    async function pollJson(file, watcher) {
        clearTimeout(watcher.timer);
        if (watcher.busy) {
            return;
        }
        let delay = readToken() ? signedInDelay : signedOutDelay;
        if (!document.hidden) {
            watcher.busy = true;
            const savesBefore = jsonSaves;
            try {
                const text = await readLatestJson(file, watcher);
                if (jsonSaves !== savesBefore) {
                    // This answer may be from before our own save; ask again next time.
                    watcher.etag = "";
                } else if (text !== null && text !== watcher.text) {
                    watcher.text = text;
                    const data = JSON.parse(text);
                    watcher.listeners.forEach((listener) => listener(data));
                }
            } catch (error) {
                if (error instanceof GitHubError) {
                    delay = limitedDelay;
                }
                // Otherwise the connection dropped for a moment; the next check tries again.
            }
            watcher.busy = false;
        }
        watcher.timer = setTimeout(() => pollJson(file, watcher), delay);
    }

    // Calls listener with the file's contents now and whenever someone changes it
    function watchJson(file, listener) {
        const existing = watchers.get(file);
        if (existing) {
            existing.listeners.push(listener);
            if (existing.text) listener(JSON.parse(existing.text));
            return;
        }
        const watcher = { listeners: [listener], etag: "", text: "", timer: 0, busy: false };
        watchers.set(file, watcher);
        pollJson(file, watcher);
    }

    function pollWatchersNow() {
        if (!document.hidden) {
            watchers.forEach((watcher, file) => pollJson(file, watcher));
        }
    }
    document.addEventListener("visibilitychange", pollWatchersNow);
    window.addEventListener("focus", pollWatchersNow);

    // Redraws without losing what someone is halfway through typing
    function keepInputs(containers, update) {
        const fields = "textarea, input[type='text'], input[type='search'], input:not([type])";
        const keyOf = (field, index) => {
            const owner = field.closest("[id], [data-card-id]");
            return `${index}|${owner?.id || owner?.dataset.cardId || ""}|${field.getAttribute("aria-label") || field.name || ""}`;
        };
        const active = document.activeElement;
        const drafts = new Map();
        let focused = null;
        containers.forEach((container, index) => {
            for (const field of container.querySelectorAll(fields)) {
                if (field.value) drafts.set(keyOf(field, index), field.value);
                if (field === active) focused = { key: keyOf(field, index), start: field.selectionStart, end: field.selectionEnd };
            }
        });
        const scrollTop = window.scrollY;
        update();
        containers.forEach((container, index) => {
            for (const field of container.querySelectorAll(fields)) {
                const key = keyOf(field, index);
                if (drafts.has(key)) field.value = drafts.get(key);
                if (focused?.key === key) {
                    field.focus({ preventScroll: true });
                    field.setSelectionRange(focused.start, focused.end);
                }
            }
        });
        window.scrollTo(window.scrollX, scrollTop);
    }

    // The number of waiting tasks next to Community and Notifications, kept up to date
    if (header && readToken() && readAccount()) {
        let knownTasks = null;
        watchJson("annotations.json", (data) => {
            const tasks = annotationTasks(data, readAccount());
            if (knownTasks !== null && tasks.length > knownTasks) {
                const { annotation, item } = tasks.at(-1);
                status.textContent = `New priority task from ${item.author} on ${annotation.pageTitle}.`;
            }
            knownTasks = tasks.length;
            header.querySelectorAll(".nav-badge").forEach((badge) => badge.remove());
            if (!tasks.length) return;
            const link = header.querySelector('.nav-menu a[href="notifications.html"]');
            for (const target of [link, link?.closest(".nav-menu")?.querySelector("button")]) {
                if (target) target.append(Object.assign(document.createElement("span"), { className: "nav-badge", textContent: String(tasks.length), title: `${tasks.length} priority task${tasks.length === 1 ? "" : "s"} for you` }));
            }
        });
    }

    if (!isNewPage && /^(?:page|news)-/.test(currentPage)) {
        const annotationScript = document.createElement("script");
        annotationScript.src = "annotations.js";
        annotationScript.dataset.wikiInjected = "";
        document.body.append(annotationScript);
    }

    window.wikiStore = {
        repositoryUrl: `https://github.com/${repository.owner}/${repository.name}`,
        roles,
        isUnlocked: () => Boolean(readToken()),
        isSignedIn: () => Boolean(readToken() && readAccount()),
        hasSharedToken: async () => Boolean(sharedToken || (sharedToken = await loadSharedToken())),
        // Turns the wiki password into the shared GitHub token. remember keeps it on this device instead of only this tab.
        async unlock(password, remember = false) {
            const existing = readToken();
            if (existing) {
                return existing;
            }
            sharedToken = sharedToken || await loadSharedToken();
            if (!sharedToken) {
                throw new Error("The wiki password has not been set up yet. Use Commit to GitHub → Set up a wiki password first.");
            }
            const token = await decryptToken(sharedToken, password);
            try {
                (remember ? localStorage : sessionStorage).setItem(tokenStorageKey, token);
            } catch {
                // Not remembered; the password is asked again next time.
            }
            return token;
        },
        async login(name, password, personalPassword, remember = false) {
            const { token, kind } = await unlockEither(password);
            const account = (await readAccounts(token)).accounts?.[accountKey(name)];
            if (!account) {
                throw new Error(`There's no account named "${name}". Register it first.`);
            }
            if (await hashPersonalPassword(personalPassword, base64ToBytes(account.salt), account.iterations) !== account.hash) {
                throw new Error("That personal password is wrong.");
            }
            const role = account.role || "editor";
            if (kind === "review" && role !== "reviewer") {
                throw new Error("Admins and editors log in with the wiki password, not the review password.");
            }
            const blocked = blockedMessage(account);
            if (blocked) {
                throw new Error(blocked);
            }
            rememberSignIn(token, account.name, role, remember);
            return { name: account.name, role };
        },
        async register(name, password, personalPassword, remember = false) {
            name = name.trim().replace(/\s+/g, " ");
            if (!/^[\p{L}\p{N}][\p{L}\p{N} _.-]{1,23}$/u.test(name)) {
                throw new Error("Usernames are 2 to 24 letters, numbers, spaces, dots, dashes or underscores.");
            }
            if (personalPassword.length < 6) {
                throw new Error("Your personal password needs at least 6 characters.");
            }
            const { token, kind } = await unlockEither(password);
            const salt = crypto.getRandomValues(new Uint8Array(16));
            const hash = await hashPersonalPassword(personalPassword, salt, accountIterations);
            let role = "reviewer";
            await updateRepositoryJson(token, accountsFile, (data) => {
                data.accounts = data.accounts || {};
                if (data.accounts[accountKey(name)]) {
                    throw new Error(`The username "${data.accounts[accountKey(name)].name}" is taken. Log in instead, or pick another.`);
                }
                // The review password makes reviewers; the wiki password makes editors, or admins for the names listed in "admins"
                role = kind === "review" ? "reviewer" : (data.admins || []).includes(accountKey(name)) ? "admin" : "editor";
                data.accounts[accountKey(name)] = {
                    name, role, salt: bytesToBase64(salt), iterations: accountIterations, hash, created: new Date().toISOString()
                };
            }, `Register account: ${name}`);
            rememberSignIn(token, name, role, remember);
            return { name, role };
        },
        signOut() {
            forgetToken();
            forgetAccount();
        },
        forget() {
            this.signOut();
        },
        // The signed-in account's name, or "" when signed out
        getAuthor() {
            return readToken() ? readAccount() : "";
        },
        // "admin", "editor" or "reviewer" while signed in, otherwise ""
        getRole: readRole,
        isAdmin: () => readRole() === "admin",
        isReviewer: () => readRole() === "reviewer",
        canReview: () => canReviewRole(readRole()),
        isEditing: () => editing,
        annotationTasks,
        watchJson,
        keepInputs,
        // itemId is the comment or reply that named this person
        markTaskDone(annotationId, itemId) {
            const name = readAccount();
            return window.wikiStore.updateJson("annotations.json", (data) => {
                const annotation = (data.annotations || []).find((entry) => entry.id === annotationId);
                const item = annotation && [annotation, ...(annotation.replies || [])].find((entry) => entry.id === itemId);
                if (!item) throw new Error("That task no longer exists. Reload the page.");
                item.done = { ...item.done, [accountKey(name)]: new Date().toISOString() };
            }, `${name} finishes a task from ${annotationId}`, { needsReview: false });
        },
        // Sends people to the login page, coming back here afterwards
        loginHref(next = location.pathname.split("/").pop() + location.search + location.hash) {
            return `login.html?${new URLSearchParams({ next })}`;
        },
        // Read the JSON file from GitHub, apply change(data, role) and commit it, retrying if someone else saved first.
        // A reviewer's commit is marked as needing review.
        updateJson(file, change, message, { needsReview = true } = {}) {
            const key = `${file}\n${message}`;
            if (!savesInFlight.has(key)) {
                const saving = (async () => {
                    const token = readToken();
                    if (!token || !readAccount()) {
                        throw new Error("Log in to save changes.");
                    }
                    const role = await checkAccount(token);
                    return updateRepositoryJson(token, file, (data) => change(data, role), role === "reviewer" && needsReview ? `${message} (needs review)` : message);
                })();
                savesInFlight.set(key, saving.finally(() => savesInFlight.delete(key)));
            }
            return savesInFlight.get(key);
        },
        // Approves everything waiting for review: ideas, votes, comments, replies, bug reports, page edits and drafts.
        async approveAllReviews() {
            const token = readToken();
            if (!token || !readAccount() || !canReviewRole(await checkAccount(token))) {
                throw new Error("Only admins and editors can approve changes.");
            }
            const name = readAccount();
            const clearing = (collect) => (data) => {
                const items = collect(data).filter((item) => item?.pending);
                items.forEach((item) => delete item.pending);
                counts.set(collect, items.length);
                return items.length ? undefined : false;
            };
            const counts = new Map();
            const controversy = (data) => [
                ...(data.ideas || []).flatMap((idea) => [idea, ...Object.values(idea.votes || {}), ...(idea.replies || [])]),
                ...(data.discussions || []).flatMap((discussion) => discussion.posts || [])
            ];
            const bugs = (data) => (data.bugs || []).flatMap((bug) => [bug, ...(bug.comments || [])]);
            const annotations = (data) => (data.annotations || []).flatMap((annotation) => [annotation, ...(annotation.replies || [])]);
            await updateRepositoryJson(token, "controversy.json", clearing(controversy), `${name} approves all waiting changes in ideas and threads`);
            await updateRepositoryJson(token, "bugs.json", clearing(bugs), `${name} approves all waiting changes in bugs`);
            await updateRepositoryJson(token, "annotations.json", clearing(annotations), `${name} approves all waiting changes in page comments`);
            const queued = JSON.parse((await getRepositoryFile(token, pendingPagesFile))?.text || "{}").pages || {};
            for (const [file, entry] of Object.entries(queued)) {
                const page = await getRepositoryFile(token, file);
                if (!page) continue;
                const doc = new DOMParser().parseFromString(page.text, "text/html");
                const blocks = [...doc.querySelectorAll(pendingSelector)];
                for (const block of blocks) {
                    if (block.classList.contains("wiki-pending-removal")) block.remove();
                    else block.replaceWith(...block.childNodes);
                }
                const heading = doc.querySelector("h1");
                const draftTitle = heading && draftPrefix.test(heading.textContent.trim()) ? heading.textContent.trim() : "";
                if (draftTitle) {
                    heading.textContent = draftTitle.replace(draftPrefix, "");
                    doc.title = doc.title.replace(draftPrefix, "");
                }
                if (blocks.length || draftTitle) {
                    const pageHtml = `<!DOCTYPE html>\n${doc.documentElement.outerHTML}\n`.replace(/\r?\n/g, page.text.includes("\r\n") ? "\r\n" : "\n");
                    await putRepositoryFile(token, file, pageHtml, `${name} approves all changes to ${(draftTitle || entry.title || file).replace(draftPrefix, "")} page`, page.sha);
                }
                if (draftTitle) await renameDraftInSearch(token, file, draftTitle);
            }
            if (Object.keys(queued).length) {
                await updatePendingPages(token, (pages) => {
                    Object.keys(queued).forEach((file) => delete pages[file]);
                }, "Update review queue for all pages");
            }
            return (counts.get(controversy) || 0) + (counts.get(bugs) || 0) + (counts.get(annotations) || 0) + Object.keys(queued).length;
        },
        // Saves a PDF to the repository and returns the commit it was saved in
        async uploadDocument(file, blob, message) {
            const token = readToken();
            if (!token || !readAccount() || !canReviewRole(await checkAccount(token))) {
                throw new Error("Only admins and editors can upload documents.");
            }
            const content = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result).split(",")[1]);
                reader.onerror = () => reject(new Error("That file could not be read."));
                reader.readAsDataURL(blob);
            });
            const path = file.split("/").map(encodeURIComponent).join("/");
            const existing = await githubRequest(token, `contents/${path}?ref=${repository.branch}`, { allowMissing: true });
            const saved = await githubRequest(token, `contents/${path}`, {
                method: "PUT",
                body: { message, content, branch: repository.branch, ...(existing?.sha ? { sha: existing.sha } : {}) }
            });
            return saved.commit.sha;
        },
        // Takes a page off the To Do list and removes its [UNRESOLVED] notes
        async resolveTodoPage(file, title) {
            const token = readToken();
            if (!token || !readAccount() || !canReviewRole(await checkAccount(token))) {
                throw new Error("Only admins and editors can resolve pages.");
            }
            const page = await getRepositoryFile(token, file);
            if (page) {
                const cleaned = stripUnresolvedNotes(page.text);
                if (cleaned !== page.text) {
                    await putRepositoryFile(token, file, cleaned, `Remove unresolved notes from ${title} page`, page.sha);
                }
            }
            const name = readAccount();
            return updateRepositoryJson(token, todoFile, (data) => {
                const entry = (data.pages || []).find((item) => item.file === file);
                if (!entry || entry.resolved) return false;
                entry.resolved = { by: name, date: new Date().toISOString() };
            }, `${name} resolves page: ${title}`);
        },
        // Admin tools ---------------------------------------------------------------------------
        async readAccounts() {
            return readAccounts(requireAdmin());
        },
        async updateAccounts(change, message) {
            const token = requireAdmin();
            await checkAccount(token);
            if (readRole() !== "admin") {
                throw new Error("Only admins can do that.");
            }
            return updateRepositoryJson(token, accountsFile, change, message);
        },
        hasReviewPassword: async () => Boolean(await loadReviewToken()),
        // Saves a copy of the GitHub token locked with the review password, so reviewers can register and log in
        async setReviewPassword(password) {
            const token = requireAdmin();
            await checkAccount(token);
            if (password.length < 8) {
                throw new Error("Use at least 8 characters for the review password.");
            }
            const encrypted = await encryptToken(token, password);
            const existing = await getRepositoryFile(token, reviewTokenFile);
            await putRepositoryFile(token, reviewTokenFile, `${JSON.stringify(encrypted, null, 2)}\n`, `${readAccount()} sets the review password`, existing?.sha);
        }
    };
    document.dispatchEvent(new Event("wiki-store-ready"));
})();

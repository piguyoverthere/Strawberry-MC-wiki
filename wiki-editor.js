(() => {
    const editableSelector = "h1, h2, h3, h4, h5, h6, p, li, td, th, blockquote, figcaption, summary";
    const pagePath = decodeURIComponent(location.pathname);
    const deploymentPath = pagePath.slice(0, pagePath.lastIndexOf("/") + 1);
    const storageKey = `strawberry-wiki-draft:${pagePath}`;
    const bookmarkStorageKey = `strawberry-wiki-bookmarks:${deploymentPath}`;
    const allowedTags = new Set(["A", "B", "BR", "CODE", "EM", "I", "S", "SMALL", "SPAN", "STRONG", "SUB", "SUP", "U"]);
    const allowedFormattedClasses = new Set(["consolas", "roman"]);
    const originalContent = new Map();
    let savedContent = new Map();
    let editing = false;

    const editableElements = [...document.querySelectorAll(editableSelector)].filter((element) =>
        !element.closest("header, nav, script, style, button, input, textarea, select, .site-search, .wiki-editor-toolbar") &&
        !element.querySelector(editableSelector)
    );

    editableElements.forEach((element, index) => {
        const id = String(index);
        element.dataset.wikiEditorId = id;
        originalContent.set(id, element.innerHTML);
    });

    function sanitizeMarkup(markup) {
        const container = document.createElement("div");
        container.innerHTML = markup;

        function clean(node) {
            for (const child of [...node.childNodes]) {
                if (child.nodeType !== Node.ELEMENT_NODE) {
                    if (child.nodeType !== Node.TEXT_NODE) {
                        child.remove();
                    }
                    continue;
                }

                clean(child);
                if (!allowedTags.has(child.tagName)) {
                    child.replaceWith(...child.childNodes);
                    continue;
                }

                for (const attribute of [...child.attributes]) {
                    if (child.tagName === "A" && attribute.name === "href") {
                        let protocol;
                        try {
                            protocol = new URL(attribute.value, document.baseURI).protocol;
                        } catch {
                            child.removeAttribute(attribute.name);
                            continue;
                        }
                        if (!["http:", "https:", "mailto:"].includes(protocol)) {
                            child.removeAttribute(attribute.name);
                        }
                    } else if (child.tagName === "A" && attribute.name === "title") {
                        continue;
                    } else if (
                        ["SPAN", "CODE"].includes(child.tagName) &&
                        attribute.name === "class" &&
                        attribute.value.split(/\s+/).every((className) => allowedFormattedClasses.has(className))
                    ) {
                        continue;
                    } else {
                        child.removeAttribute(attribute.name);
                    }
                }
            }
        }

        clean(container);
        return container.innerHTML;
    }

    function readSavedContent() {
        const serialized = localStorage.getItem(storageKey);
        if (serialized === null) {
            return new Map(originalContent);
        }

        const parsed = JSON.parse(serialized);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new Error("Saved edits have an invalid format.");
        }

        const content = new Map(originalContent);
        for (const [id, markup] of Object.entries(parsed)) {
            if (content.has(id) && typeof markup === "string") {
                content.set(id, sanitizeMarkup(markup));
            }
        }
        return content;
    }

    function applyContent(content) {
        for (const element of editableElements) {
            const markup = content.get(element.dataset.wikiEditorId);
            if (markup !== undefined) {
                element.innerHTML = markup;
            }
        }
    }

    const toolbar = document.createElement("section");
    toolbar.className = "wiki-editor-toolbar";
    toolbar.setAttribute("aria-label", "Page editing tools");
    toolbar.innerHTML = `
        <button type="button" data-action="edit">Edit page</button>
        <button type="button" data-action="save" disabled>Save edits</button>
        <button type="button" data-action="cancel" disabled>Cancel</button>
        <button type="button" data-action="download">Download HTML</button>
        <button type="button" data-action="reset">Reset saved edits</button>
        <span class="wiki-editor-status" role="status" aria-live="polite"></span>
    `;

    const header = document.querySelector(".site-header");
    if (header) {
        header.insertAdjacentElement("afterend", toolbar);
        const nav = header.querySelector("nav");
        if (nav && !nav.querySelector('a[href="page-bookmarked-pages.html"]')) {
            const bookmarksLink = document.createElement("a");
            bookmarksLink.href = "page-bookmarked-pages.html";
            bookmarksLink.textContent = "Bookmarked Pages";
            const pdfLink = nav.querySelector('a[href$=".pdf"]');
            nav.insertBefore(document.createTextNode(" | "), pdfLink);
            nav.insertBefore(bookmarksLink, pdfLink);
        }
    } else {
        document.body.prepend(toolbar);
    }

    const editButton = toolbar.querySelector('[data-action="edit"]');
    const saveButton = toolbar.querySelector('[data-action="save"]');
    const cancelButton = toolbar.querySelector('[data-action="cancel"]');
    const status = toolbar.querySelector(".wiki-editor-status");
    const bookmarkButton = document.createElement("button");
    bookmarkButton.type = "button";
    bookmarkButton.className = "wiki-bookmark-button";
    bookmarkButton.setAttribute("aria-pressed", "false");
    const bookmarkStatus = document.createElement("span");
    bookmarkStatus.className = "wiki-bookmark-status";
    bookmarkStatus.setAttribute("role", "status");
    bookmarkStatus.setAttribute("aria-live", "polite");
    toolbar.insertBefore(bookmarkButton, status);
    toolbar.insertBefore(bookmarkStatus, status);

    const currentPage = pagePath.split("/").pop();
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

    function getCurrentTitle() {
        return document.querySelector("h1")?.textContent.trim() || document.title;
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
        bookmarkButton.textContent = isBookmarked ? "★ Remove bookmark" : "☆ Bookmark page";
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

    function setEditing(value) {
        editing = value;
        document.body.classList.toggle("wiki-editing", value);
        for (const element of editableElements) {
            element.contentEditable = value ? "true" : "false";
            element.spellcheck = value;
        }
        editButton.disabled = value;
        saveButton.disabled = !value;
        cancelButton.disabled = !value;
        status.textContent = value
            ? "Edit the page text, then save or cancel."
            : "";
    }

    function saveEdits() {
        const content = new Map();
        for (const element of editableElements) {
            const id = element.dataset.wikiEditorId;
            const cleanMarkup = sanitizeMarkup(element.innerHTML);
            element.innerHTML = cleanMarkup;
            content.set(id, cleanMarkup);
        }

        try {
            localStorage.setItem(storageKey, JSON.stringify(Object.fromEntries(content)));
        } catch (error) {
            status.textContent = `Could not save edits in this browser: ${error.message}`;
            return false;
        }

        savedContent = content;
        setEditing(false);
        status.textContent = "Edits saved in this browser. Download HTML to update the site file.";
        return true;
    }

    function downloadPage() {
        const copy = document.documentElement.cloneNode(true);
        copy.querySelectorAll(".wiki-editor-toolbar").forEach((element) => element.remove());
        copy.querySelectorAll("[contenteditable], [data-wiki-editor-id]").forEach((element) => {
            element.removeAttribute("contenteditable");
            element.removeAttribute("data-wiki-editor-id");
            element.removeAttribute("spellcheck");
        });

        const doctype = document.doctype
            ? `<!DOCTYPE ${document.doctype.name}>`
            : "<!DOCTYPE html>";
        const blob = new Blob([`${doctype}\n${copy.outerHTML}`], { type: "text/html;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = decodeURIComponent(location.pathname).split("/").pop() || "index.html";
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        status.textContent = "Downloaded an HTML copy of this page.";
    }

    editButton.addEventListener("click", () => setEditing(true));
    saveButton.addEventListener("click", saveEdits);
    cancelButton.addEventListener("click", () => {
        applyContent(savedContent);
        setEditing(false);
        status.textContent = "Unsaved edits discarded.";
    });

    toolbar.querySelector('[data-action="download"]').addEventListener("click", () => {
        if (!editing || saveEdits()) {
            downloadPage();
        }
    });

    toolbar.querySelector('[data-action="reset"]').addEventListener("click", () => {
        if (!window.confirm("Remove saved browser edits and restore this page to its original text?")) {
            return;
        }
        try {
            localStorage.removeItem(storageKey);
        } catch (error) {
            status.textContent = `Could not clear saved edits: ${error.message}`;
            return;
        }
        savedContent = new Map(originalContent);
        applyContent(savedContent);
        setEditing(false);
        status.textContent = "Saved edits removed; original page text restored.";
    });

    try {
        savedContent = readSavedContent();
        applyContent(savedContent);
        if (localStorage.getItem(storageKey) !== null) {
            status.textContent = "Saved browser edits are applied.";
        }
    } catch (error) {
        savedContent = new Map(originalContent);
        status.textContent = `Could not load saved edits: ${error.message}`;
    }

    setEditing(false);
})();

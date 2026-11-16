// ComScript Tutorial: the contents sidebar on the left, and Previous / Next buttons under each step.
// wiki-editor.js loads this on tutorial-*.html pages (and on a tutorial page being written at new-page.html).
// The order of the steps lives in tutorial.json: { sections: [{ id, title, pages: [{ file, title }] }] }.
// Each tab's name is set here and can differ from the page's own heading. Tutorial pages stay out of search,
// so the tutorial is reached from its menu item. Admins and editors change the contents with "Edit contents".
(() => {
    const store = window.wikiStore;
    const dataFile = "tutorial.json";
    const indexFile = "tutorial-index.html";
    const collapsedKey = "strawberry-wiki-tutorial-collapsed";
    const hiddenKey = "strawberry-wiki-tutorial-sidebar-hidden";
    const params = new URLSearchParams(location.search);
    const currentPage = decodeURIComponent(location.pathname).split("/").pop() || "index.html";
    // A step being written for the first time is at new-page.html?file=tutorial-…&section=…
    const draftFile = currentPage === "new-page.html" ? params.get("file") || "" : "";
    const currentFile = draftFile || currentPage;
    const draftSection = params.get("section") || "";

    let data = { sections: [] };
    let editingContents = false;
    let saving = false;

    // Edits saved in this browser, per page, as wiki-editor.js stores them
    const pagePath = decodeURIComponent(location.pathname);
    const deploymentPath = pagePath.slice(0, pagePath.lastIndexOf("/") + 1);
    const draftKey = (file) => `strawberry-wiki-draft:${deploymentPath}${file}`;
    const hasDraft = (file) => {
        try {
            return localStorage.getItem(draftKey(file)) !== null;
        } catch {
            return false;
        }
    };
    // New steps that aren't committed yet: { file: { title, section } }, so every one shows in the sidebar
    const newStepsKey = `strawberry-wiki-tutorial-new:${deploymentPath}`;
    function readNewSteps() {
        try {
            return JSON.parse(localStorage.getItem(newStepsKey) || "{}") || {};
        } catch {
            return {};
        }
    }
    function writeNewSteps(steps) {
        try {
            localStorage.setItem(newStepsKey, JSON.stringify(steps));
        } catch {
            // Storage blocked; only the open step shows.
        }
    }
    if (draftFile) {
        const steps = readNewSteps();
        steps[draftFile] = { title: params.get("title") || draftFile, section: draftSection };
        writeNewSteps(steps);
    }
    // Moving between steps while editing keeps editing on the next one
    const resumeKey = "strawberry-wiki-tutorial-resume-editing";

    function element(tag, options = {}, ...children) {
        const node = document.createElement(tag);
        for (const [key, value] of Object.entries(options)) {
            if (key === "className") node.className = value;
            else if (key === "text") node.textContent = value;
            else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
            else if (value !== undefined && value !== null && value !== false) node.setAttribute(key, value === true ? "" : value);
        }
        node.append(...children.filter((child) => child !== null && child !== undefined && child !== false));
        return node;
    }

    function readSet(key) {
        try {
            return new Set(JSON.parse(localStorage.getItem(key) || "[]"));
        } catch {
            return new Set();
        }
    }

    function writeSet(key, set) {
        try {
            localStorage.setItem(key, JSON.stringify([...set]));
        } catch {
            // Storage blocked; sections just start open next time.
        }
    }

    const slugPart = (text) => text.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/['’]/g, "")
        .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

    // Reading order: the overview, then every step in every section
    function order() {
        return [{ file: indexFile, title: "Overview" }, ...data.sections.flatMap((section) => section.pages || [])];
    }

    const canEdit = () => Boolean(store?.canReview());

    // Layout ------------------------------------------------------------------------------------
    document.documentElement.classList.add("wiki-tutorial");
    const sidebar = element("aside", { className: "tutorial-sidebar", "aria-label": "ComScript Tutorial contents", "data-wiki-injected": true });
    const showButton = element("button", {
        type: "button", className: "tutorial-show-button", "data-wiki-injected": true, "aria-label": "Show tutorial contents",
        onclick: () => setHidden(false)
    }, "☰ Contents");
    const pager = element("nav", { className: "tutorial-pager", "aria-label": "Tutorial steps", "data-wiki-injected": true });
    const header = document.querySelector(".site-header");
    (header || document.body.firstChild)?.after?.(sidebar);
    if (!sidebar.isConnected) document.body.prepend(sidebar);
    document.body.append(showButton);

    function placePager() {
        const content = document.querySelector(".wiki-content");
        const after = document.querySelector(".wiki-last-edited") || content;
        after?.after(pager);
    }

    // The sidebar sits below the sticky header, so it needs the header's height
    function measureHeader() {
        const height = header ? Math.round(header.getBoundingClientRect().height) : 0;
        document.documentElement.style.setProperty("--tutorial-top", `${height}px`);
    }
    measureHeader();
    window.addEventListener("resize", measureHeader);

    function setHidden(hidden) {
        document.documentElement.classList.toggle("tutorial-sidebar-hidden", hidden);
        try {
            if (hidden) localStorage.setItem(hiddenKey, "1");
            else localStorage.removeItem(hiddenKey);
        } catch {
            // Storage blocked; it just opens again next time.
        }
    }
    try {
        if (localStorage.getItem(hiddenKey)) setHidden(true);
    } catch {
        // Storage blocked.
    }

    // A small dialog for names, instead of the browser's prompt box
    function askText(title, label, value = "") {
        return new Promise((resolve) => {
            const input = element("input", { type: "text", maxlength: "80", value });
            // Finishes straight from the buttons rather than waiting for the dialog's close event
            let done = false;
            const finish = (answer) => {
                if (done) return;
                done = true;
                if (dialog.open) dialog.close();
                dialog.remove();
                resolve(answer);
            };
            const dialog = element("dialog", { className: "wiki-dialog", "data-wiki-injected": true },
                element("form", { method: "dialog" },
                    element("h2", { text: title }),
                    element("label", {}, label, input),
                    element("div", { className: "wiki-dialog-actions" },
                        element("button", { type: "button", text: "Cancel", onclick: () => finish(null) }),
                        element("button", { type: "submit", className: "wiki-primary", text: "OK" }))));
            dialog.querySelector("form").addEventListener("submit", (event) => {
                event.preventDefault();
                finish(input.value.trim() || null);
            });
            dialog.addEventListener("cancel", () => finish(null));
            dialog.addEventListener("close", () => finish(null));
            document.body.append(dialog);
            dialog.showModal();
            input.select();
        });
    }

    const status = element("p", { className: "tutorial-status", role: "status" });

    async function change(apply, message) {
        if (saving) return;
        saving = true;
        status.textContent = "Saving…";
        try {
            const fresh = await store.updateJson(dataFile, (saved) => {
                saved.sections = saved.sections || [];
                return apply(saved);
            }, message, { needsReview: false });
            data = { sections: fresh.sections || [] };
            status.textContent = "Saved.";
        } catch (error) {
            status.textContent = `Could not save: ${error.message}`;
        }
        saving = false;
        render();
    }

    const contentsMessage = () => `${store.getAuthor()} changes the ComScript Tutorial contents`;

    // The contents as shown: committed steps from tutorial.json, with new steps (not committed yet, kept in this
    // browser) placed among them. A new step remembers its section and the committed step it comes after
    // ("" for the top of the section; missing for the end).
    function layout() {
        const pending = pendingSteps();
        return data.sections.map((section) => {
            const items = (section.pages || []).map((page) => ({ ...page, draft: false }));
            for (const step of pending.filter((item) => item.section === section.id)) {
                let index = items.length;
                if (step.after === "") index = 0;
                else if (step.after) {
                    const anchor = items.findIndex((item) => !item.draft && item.file === step.after);
                    if (anchor >= 0) index = anchor + 1;
                }
                // New steps with the same place keep their order
                while (index < items.length && items[index].draft) index++;
                items.splice(index, 0, { ...step, draft: true });
            }
            return { ...section, items };
        });
    }

    // Saves a rearranged layout: new steps' places stay in this browser; committed steps' order is saved to
    // tutorial.json only if it changed
    function saveLayout(sections) {
        const steps = {};
        for (const section of sections) {
            let after = "";
            for (const item of section.items) {
                if (item.draft) steps[item.file] = { title: item.title, section: section.id, after };
                else after = item.file;
            }
        }
        writeNewSteps(steps);
        const wanted = sections.map((section) => [section.id, section.items.filter((item) => !item.draft).map((item) => item.file)]);
        const same = wanted.every(([id, files]) => {
            const current = (data.sections.find((section) => section.id === id)?.pages || []).map((page) => page.file);
            return current.length === files.length && current.every((file, index) => file === files[index]);
        });
        if (same) {
            render();
            return;
        }
        change((saved) => {
            const pages = new Map();
            const home = new Map();
            for (const section of saved.sections) {
                for (const page of section.pages || []) {
                    pages.set(page.file, page);
                    home.set(page.file, section.id);
                }
            }
            const placed = new Set();
            for (const [id, files] of wanted) {
                const section = saved.sections.find((item) => item.id === id);
                if (!section) continue;
                section.pages = files.filter((file) => pages.has(file)).map((file) => {
                    placed.add(file);
                    return pages.get(file);
                });
            }
            // Steps someone else added meanwhile stay in their section
            for (const [file, page] of pages) {
                if (placed.has(file)) continue;
                const section = saved.sections.find((item) => item.id === home.get(file));
                if (section) section.pages.push(page);
            }
            return undefined;
        }, contentsMessage());
    }

    // Moves a step, new or committed, up or down; at the edge of a section it moves into the next or previous one
    function moveItem(file, step) {
        const sections = layout();
        const from = sections.findIndex((section) => section.items.some((item) => item.file === file));
        if (from < 0) return;
        const list = sections[from].items;
        const index = list.findIndex((item) => item.file === file);
        const [item] = list.splice(index, 1);
        if (step < 0 && index > 0) list.splice(index - 1, 0, item);
        else if (step > 0 && index < list.length) list.splice(index + 1, 0, item);
        else if (sections[from + step]) {
            if (step < 0) sections[from + step].items.push(item);
            else sections[from + step].items.unshift(item);
        } else return;
        saveLayout(sections);
    }

    async function renameNewStep(step) {
        const title = await askText("Rename this tab", "Tab name", step.title);
        if (!title || title === step.title) return;
        const steps = readNewSteps();
        if (!steps[step.file]) return;
        steps[step.file].title = title;
        writeNewSteps(steps);
        render();
    }

    function discardNewStep(step) {
        if (!window.confirm(`Throw away the new step "${step.title}" and everything written in it? It was never committed, so this can't be undone.`)) return;
        try {
            localStorage.removeItem(draftKey(step.file));
        } catch {
            // Nothing saved.
        }
        const steps = readNewSteps();
        delete steps[step.file];
        writeNewSteps(steps);
        if (step.file === currentFile) {
            location.href = indexFile;
            return;
        }
        render();
    }

    function moveSection(id, step) {
        change((saved) => {
            const index = saved.sections.findIndex((section) => section.id === id);
            const target = index + step;
            if (index < 0 || target < 0 || target >= saved.sections.length) return false;
            [saved.sections[index], saved.sections[target]] = [saved.sections[target], saved.sections[index]];
            return undefined;
        }, contentsMessage());
    }

    async function renameStep(page) {
        const title = await askText("Rename this tab", "Tab name", page.title);
        if (!title || title === page.title) return;
        change((saved) => {
            const found = saved.sections.flatMap((section) => section.pages || []).find((item) => item.file === page.file);
            if (!found) return false;
            found.title = title;
            return undefined;
        }, contentsMessage());
    }

    function removeStep(page) {
        if (!window.confirm(`Take "${page.title}" out of the tutorial? The page itself isn't deleted, but nobody will be able to reach it from the tutorial.`)) return;
        change((saved) => {
            for (const section of saved.sections) section.pages = (section.pages || []).filter((item) => item.file !== page.file);
            return undefined;
        }, contentsMessage());
    }

    async function addSection() {
        const title = await askText("Add a section", "Section name");
        if (!title) return;
        change((saved) => {
            let id = slugPart(title) || "section";
            while (saved.sections.some((section) => section.id === id)) id += "-2";
            saved.sections.push({ id, title, pages: [] });
            return undefined;
        }, contentsMessage());
    }

    async function renameSection(section) {
        const title = await askText("Rename this section", "Section name", section.title);
        if (!title || title === section.title) return;
        change((saved) => {
            const found = saved.sections.find((item) => item.id === section.id);
            if (!found) return false;
            found.title = title;
            return undefined;
        }, contentsMessage());
    }

    function removeSection(section) {
        if (section.pages?.length) {
            status.textContent = "Move or take out this section's steps first.";
            return;
        }
        change((saved) => {
            const before = saved.sections.length;
            saved.sections = saved.sections.filter((item) => item.id !== section.id);
            return saved.sections.length === before ? false : undefined;
        }, contentsMessage());
    }

    // A new step opens in the editor; it joins the contents when it's first committed
    async function addStep(section) {
        const title = await askText(`New step in "${section.title}"`, "Page title");
        if (!title) return;
        const slug = slugPart(title);
        if (!slug) {
            status.textContent = "Use at least one letter or number in the title.";
            return;
        }
        const file = `tutorial-${slug}.html`;
        if (file === indexFile || order().some((page) => page.file === file)) {
            status.textContent = `There's already a tutorial page called ${file}. Choose a different title.`;
            return;
        }
        try {
            const response = await fetch(file, { method: "HEAD", cache: "no-store" });
            if (response.ok) {
                status.textContent = `${file} already exists. Choose a different title.`;
                return;
            }
        } catch {
            // Can't check from here; committing still refuses to overwrite without asking.
        }
        // Edits open on this page are saved first, like moving to another step
        const editor = window.wikiEditor;
        if (editor?.hasChanges() && editor.saveDraft() === false) return;
        location.href = `new-page.html?${new URLSearchParams({ file, title, section: section.id })}`;
    }

    function iconButton(text, label, onclick, disabled = false) {
        return element("button", { type: "button", className: "tutorial-tool", title: label, "aria-label": label, text, onclick, disabled });
    }

    // The reorder arrows and other contents tools show while editing a page, or after "Edit contents"
    const pageEditing = () => Boolean(window.wikiEditor?.isEditing());
    const showTools = () => canEdit() && (editingContents || pageEditing());

    function stepLink(page, isDraft = false, steps = []) {
        const current = page.file === currentFile;
        const href = isDraft ? `new-page.html?${new URLSearchParams({ file: page.file, title: page.title, section: page.section || "" })}` : page.file;
        const edited = !isDraft && hasDraft(page.file);
        return element("li", { className: `tutorial-step${current ? " is-current" : ""}${isDraft ? " is-draft" : ""}` },
            element("a", { href, "aria-current": current ? "page" : null, onclick: leaveFor(href) },
                page.title,
                isDraft ? element("span", { className: "tutorial-draft-note", text: " (not committed yet)" }) : null,
                edited ? element("span", { className: "tutorial-edited-dot", title: "Edits saved in this browser, not committed yet", "aria-label": "edited, not committed", text: " ●" }) : null),
            showTools() && page.file !== indexFile ? element("span", { className: "tutorial-tools" },
                // At the top or bottom of a section, a step moves into the section before or after
                iconButton("↑", `Move "${page.title}" up`, () => moveItem(page.file, -1), steps[0]?.file === page.file),
                iconButton("↓", `Move "${page.title}" down`, () => moveItem(page.file, 1), steps[steps.length - 1]?.file === page.file),
                isDraft
                    ? iconButton("✎", `Rename the new step "${page.title}"`, () => renameNewStep(page))
                    : iconButton("✎", `Rename the "${page.title}" tab`, () => renameStep(page)),
                isDraft
                    ? iconButton("×", `Throw away the new step "${page.title}"`, () => discardNewStep(page))
                    : iconButton("×", `Take "${page.title}" out of the tutorial`, () => removeStep(page))) : null);
    }

    // New steps not committed yet: dropped once they're in the contents, or once their draft is gone
    function pendingSteps() {
        const listed = new Set(order().map((page) => page.file));
        const steps = readNewSteps();
        let changed = false;
        for (const file of Object.keys(steps)) {
            if (listed.has(file) || (!hasDraft(file) && file !== draftFile)) {
                delete steps[file];
                changed = true;
            }
        }
        if (changed) writeNewSteps(steps);
        const sections = new Set(data.sections.map((section) => section.id));
        const fallback = data.sections[data.sections.length - 1]?.id;
        return Object.entries(steps).map(([file, step]) => sections.has(step.section)
            ? { file, title: step.title, section: step.section, after: step.after }
            // Its section was removed: it goes to the end of the last section
            : { file, title: step.title, section: fallback });
    }

    // Every tutorial page with edits saved in this browser, in reading order. A new step says what comes just
    // before it, so committing puts it exactly where it was placed.
    function changedPages() {
        const pages = hasDraft(indexFile) ? [{ file: indexFile, title: "Overview", isNew: false }] : [];
        for (const section of layout()) {
            let after = "";
            for (const item of section.items) {
                if (hasDraft(item.file)) pages.push(item.draft ? { file: item.file, title: item.title, section: section.id, after, isNew: true } : { file: item.file, title: item.title, isNew: false });
                // Only steps that will be in the contents after the commit can be what a new step follows
                if (!item.draft || hasDraft(item.file)) after = item.file;
            }
        }
        return pages;
    }

    // Following a link while editing saves the edits first and keeps editing on the next page
    function leaveFor(href) {
        return (event) => {
            const editor = window.wikiEditor;
            if (!editor?.isEditing() || event.ctrlKey || event.metaKey || event.shiftKey || event.button !== 0) return;
            event.preventDefault();
            if (editor.hasChanges() && editor.saveDraft() === false) return;
            try {
                sessionStorage.setItem(resumeKey, "1");
            } catch {
                // Without storage the next page just opens for reading.
            }
            location.href = href;
        };
    }

    async function commitAll() {
        const editor = window.wikiEditor;
        if (editor?.hasChanges() && editor.saveDraft() === false) return;
        const pages = changedPages();
        if (!pages.length) {
            status.textContent = "There are no saved edits to commit.";
            render();
            return;
        }
        if (!window.confirm(`Commit these ${pages.length} page${pages.length === 1 ? "" : "s"} to GitHub in one commit?\n\n${pages.map((page) => `• ${page.title}${page.isNew ? " (new)" : ""}`).join("\n")}`)) return;
        status.textContent = "Committing…";
        commitButton.disabled = true;
        try {
            await store.commitTutorialDrafts(pages);
            try {
                sessionStorage.setItem("strawberry-wiki-tutorial-committed", String(pages.length));
                sessionStorage.removeItem(resumeKey);
            } catch {
                // Fine.
            }
            // A step that was being written now has its own address
            location.href = draftFile && pages.some((page) => page.file === draftFile) ? draftFile : location.href;
        } catch (error) {
            status.textContent = `Could not commit: ${error.message}`;
            commitButton.disabled = false;
        }
    }
    const commitButton = element("button", { type: "button", className: "tutorial-commit-all", onclick: commitAll });

    function render() {
        const collapsed = readSet(collapsedKey);
        const arranged = layout();
        const everyStep = arranged.flatMap((section) => section.items);
        const sections = data.sections.map((section, sectionIndex) => {
            const pages = section.pages || [];
            // New steps show among the others until they're committed
            const items = arranged[sectionIndex].items;
            const holdsCurrent = items.some((item) => item.file === currentFile);
            const details = element("details", { className: "tutorial-section", open: !collapsed.has(section.id) || holdsCurrent },
                element("summary", {}, element("span", { className: "tutorial-section-title", text: section.title }),
                    element("span", { className: "tutorial-count", text: String(items.length) })),
                items.length ? element("ol", { className: "tutorial-steps" }, ...items.map((item) => stepLink(item, item.draft, everyStep)))
                    : element("p", { className: "tutorial-empty", text: "No steps yet." }),
                showTools() ? element("div", { className: "tutorial-section-tools" },
                    element("button", { type: "button", className: "tutorial-add", text: "+ Page", onclick: () => addStep(section) }),
                    iconButton("↑", `Move section "${section.title}" up`, () => moveSection(section.id, -1), sectionIndex === 0),
                    iconButton("↓", `Move section "${section.title}" down`, () => moveSection(section.id, 1), sectionIndex === data.sections.length - 1),
                    iconButton("✎", `Rename section "${section.title}"`, () => renameSection(section)),
                    iconButton("×", `Remove section "${section.title}"`, () => removeSection(section))) : null);
            details.addEventListener("toggle", () => {
                const set = readSet(collapsedKey);
                if (details.open) set.delete(section.id);
                else set.add(section.id);
                writeSet(collapsedKey, set);
            });
            return details;
        });
        // Parts with nothing to show are null; leave them out (replaceChildren would print "null")
        sidebar.replaceChildren(...[
            element("div", { className: "tutorial-sidebar-head" },
                element("a", { className: "tutorial-title", href: indexFile, text: "ComScript Tutorial" }),
                element("button", { type: "button", className: "tutorial-hide-button", title: "Hide the contents", "aria-label": "Hide the contents", text: "«", onclick: () => setHidden(true) })),
            element("ol", { className: "tutorial-steps tutorial-overview" }, stepLink({ file: indexFile, title: "Overview" })),
            ...sections,
            canEdit() && changedPages().length ? (commitButton.textContent = `Commit all changes (${changedPages().length})`, commitButton) : null,
            canEdit() ? element("div", { className: "tutorial-edit-bar" },
                showTools() ? element("button", { type: "button", className: "tutorial-add", text: "+ Section", onclick: addSection }) : null,
                // While a page is being edited the tools are already showing
                pageEditing() ? null : element("button", {
                    type: "button", className: "tutorial-edit-toggle", text: editingContents ? "Done" : "Edit contents",
                    onclick: () => { editingContents = !editingContents; render(); }
                })) : null,
            status].filter(Boolean));
        renderPager();
    }

    function renderPager() {
        const steps = order();
        const index = steps.findIndex((page) => page.file === currentFile);
        if (index < 0) {
            pager.replaceChildren();
            pager.hidden = true;
            return;
        }
        const previous = steps[index - 1];
        const next = steps[index + 1];
        pager.hidden = !previous && !next;
        pager.replaceChildren(
            previous ? element("a", { className: "tutorial-pager-link tutorial-previous", href: previous.file, rel: "prev", onclick: leaveFor(previous.file) },
                element("span", { className: "tutorial-pager-label", text: "← Previous" }), element("span", { className: "tutorial-pager-title", text: previous.title })) : element("span"),
            next ? element("a", { className: "tutorial-pager-link tutorial-next", href: next.file, rel: "next", onclick: leaveFor(next.file) },
                element("span", { className: "tutorial-pager-label", text: "Next →" }), element("span", { className: "tutorial-pager-title", text: next.title })) : element("span"));
    }

    // The "Last edited" line arrives a moment after the page; keep the buttons below it
    new MutationObserver(() => {
        if (pager.previousElementSibling !== (document.querySelector(".wiki-last-edited") || document.querySelector(".wiki-content"))) placePager();
    }).observe(document.body, { childList: true });
    placePager();
    render();
    // Counts and dots follow saves, cancels and commits on this page
    document.addEventListener("wiki-drafts-changed", () => render());

    // Arrived here from another step while editing: carry on editing
    try {
        if (sessionStorage.getItem(resumeKey)) {
            sessionStorage.removeItem(resumeKey);
            window.wikiEditor?.startEditing();
        }
        const committed = sessionStorage.getItem("strawberry-wiki-tutorial-committed");
        if (committed) {
            sessionStorage.removeItem("strawberry-wiki-tutorial-committed");
            status.textContent = `Committed ${committed} page${committed === "1" ? "" : "s"}. The live site updates in a minute or two.`;
        }
    } catch {
        // Storage blocked.
    }

    const receive = (json) => {
        data = { sections: Array.isArray(json?.sections) ? json.sections : [] };
        render();
    };
    if (store?.watchJson) {
        store.watchJson(dataFile, receive);
    } else {
        fetch(dataFile, { cache: "no-cache" }).then((response) => response.ok ? response.json() : {}).then(receive).catch(() => {});
    }
})();

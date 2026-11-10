// Comments on a selected part of an article, backed by annotations.json in the repository.
// "@name" in a comment assigns that person a priority task, shown highlighted in their notifications.
(() => {
    const root = document.querySelector(".wiki-content");
    const store = window.wikiStore;
    if (!root || !store) {
        return;
    }

    const dataFile = "annotations.json";
    const page = decodeURIComponent(location.pathname).split("/").pop();
    const markClass = "wiki-annotation-mark";
    const excluded = "[data-wiki-island], .wiki-raw-html";
    const contextLength = 32;
    const maxQuote = 1000;
    let data = { annotations: [] };
    let accountNames = [];

    function element(tag, options = {}, ...children) {
        const node = document.createElement(tag);
        for (const [key, value] of Object.entries(options)) {
            if (key === "className") node.className = value;
            else if (key === "text") node.textContent = value;
            else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
            else if (value !== undefined && value !== null && value !== false) node.setAttribute(key, value === true ? "" : value);
        }
        node.append(...children.filter((child) => child !== null && child !== undefined));
        return node;
    }

    const formatTime = (value) => new Date(value).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
    const nameKey = (name) => name.trim().toLowerCase();
    const newId = (prefix) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const pageTitle = () => root.querySelector("h1")?.textContent.trim() || document.title;
    const onThisPage = () => (data.annotations || []).filter((annotation) => annotation.page === page);
    // Reviewers' comments wait for an admin or editor, like their other comments
    const pendingMark = (role) => role === "reviewer" ? { pending: true } : {};

    // Finding text ----------------------------------------------------------------------------
    function textNodes() {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
            acceptNode: (node) => node.parentElement.closest(excluded) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
        });
        const nodes = [];
        let text = "";
        while (walker.nextNode()) {
            nodes.push({ node: walker.currentNode, start: text.length });
            text += walker.currentNode.data;
        }
        return { nodes, text };
    }

    function offsetOf(flat, container, offset) {
        if (container.nodeType === Node.TEXT_NODE) {
            const entry = flat.nodes.find((item) => item.node === container);
            return entry ? entry.start + offset : -1;
        }
        // The boundary sits between elements: use the first text node after it
        const after = container.childNodes[offset];
        const range = document.createRange();
        range.setStart(container, offset);
        range.setEnd(root, root.childNodes.length);
        const entry = flat.nodes.find((item) => range.intersectsNode(item.node) && (!after || after === item.node || after.contains(item.node) || after.compareDocumentPosition(item.node) & Node.DOCUMENT_POSITION_FOLLOWING));
        return entry ? entry.start : flat.text.length;
    }

    function describeSelection() {
        const selection = document.getSelection();
        if (store.isEditing() || !selection.rangeCount || selection.isCollapsed) return null;
        const range = selection.getRangeAt(0);
        if (!root.contains(range.commonAncestorContainer)) return null;
        const elementOf = (node) => node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
        if (elementOf(range.startContainer).closest(excluded) || elementOf(range.endContainer).closest(excluded)) return null;
        const flat = textNodes();
        const start = offsetOf(flat, range.startContainer, range.startOffset);
        const end = offsetOf(flat, range.endContainer, range.endOffset);
        const quote = start < 0 || end <= start ? "" : flat.text.slice(start, end);
        if (!quote.trim() || quote.length > maxQuote) return null;
        return {
            quote,
            prefix: flat.text.slice(Math.max(0, start - contextLength), start),
            suffix: flat.text.slice(end, end + contextLength),
            rect: range.getBoundingClientRect()
        };
    }

    // The same words can appear twice, so pick the place whose surrounding text matches best
    function locate(text, annotation) {
        let best = -1;
        let bestScore = -1;
        for (let index = text.indexOf(annotation.quote); index !== -1; index = text.indexOf(annotation.quote, index + 1)) {
            let score = 0;
            const before = text.slice(0, index);
            const after = text.slice(index + annotation.quote.length);
            while (score < annotation.prefix.length && before[before.length - 1 - score] === annotation.prefix[annotation.prefix.length - 1 - score]) score++;
            let tail = 0;
            while (tail < annotation.suffix.length && after[tail] === annotation.suffix[tail]) tail++;
            if (score + tail > bestScore) {
                bestScore = score + tail;
                best = index;
            }
        }
        return best;
    }

    function clearMarks() {
        for (const mark of [...root.querySelectorAll(`mark.${markClass}`)]) {
            mark.replaceWith(...mark.childNodes);
        }
        root.normalize();
    }

    function markText(annotation) {
        const flat = textNodes();
        const start = locate(flat.text, annotation);
        if (start < 0) return false;
        const end = start + annotation.quote.length;
        for (const { node, start: nodeStart } of flat.nodes) {
            const from = Math.max(start, nodeStart) - nodeStart;
            const to = Math.min(end, nodeStart + node.data.length) - nodeStart;
            if (to <= from || !node.data.slice(from, to).trim()) continue;
            const range = document.createRange();
            range.setStart(node, from);
            range.setEnd(node, to);
            const mark = element("mark", { className: `${markClass}${annotation.pending ? " wiki-annotation-pending" : ""}`, "data-annotation-id": annotation.id });
            range.surroundContents(mark);
        }
        return true;
    }

    // Saving ----------------------------------------------------------------------------------
    function save(change, message, options) {
        return store.updateJson(dataFile, (fresh, role) => {
            fresh.annotations = fresh.annotations || [];
            change(fresh, role);
        }, message, options).then((saved) => {
            data = saved;
            render();
        });
    }

    function report(promise) {
        promise.catch((error) => window.alert(`Could not save: ${error.message}`));
    }

    function mentionsIn(text) {
        const found = [];
        for (const name of [...accountNames].sort((a, b) => b.length - a.length)) {
            const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            if (new RegExp(`(^|[^\\p{L}\\p{N}_])@${escaped}(?![\\p{L}\\p{N}_])`, "iu").test(text)) found.push(name);
        }
        return found;
    }

    const describeMessage = (name, mentions) => mentions.length
        ? `${name} assigns ${mentions.join(", ")} on page: ${pageTitle()}`
        : `${name} comments on page: ${pageTitle()}`;

    function addAnnotation(anchor, text) {
        const name = store.getAuthor();
        const mentions = mentionsIn(text);
        return save((fresh, role) => {
            fresh.annotations.push({
                id: newId("ann"), page, pageTitle: pageTitle(), quote: anchor.quote, prefix: anchor.prefix, suffix: anchor.suffix,
                author: name, text, date: new Date().toISOString(), mentions, replies: [], ...pendingMark(role)
            });
        }, describeMessage(name, mentions));
    }

    function addReply(annotation, text) {
        const name = store.getAuthor();
        const mentions = mentionsIn(text);
        return save((fresh, role) => {
            const target = fresh.annotations.find((item) => item.id === annotation.id);
            if (!target) throw new Error("This comment no longer exists. Reload the page.");
            target.replies = target.replies || [];
            target.replies.push({ id: newId("reply"), author: name, text, date: new Date().toISOString(), mentions, ...pendingMark(role) });
        }, describeMessage(name, mentions));
    }

    function removeAnnotation(annotation) {
        if (!window.confirm("Delete this comment and its replies?")) return;
        const name = store.getAuthor();
        report(save((fresh) => {
            fresh.annotations = fresh.annotations.filter((item) => item.id !== annotation.id);
        }, `${name} deletes a comment on page: ${annotation.pageTitle}`, { needsReview: false }));
        closePopover();
    }

    function moderate(approve, annotation, reply) {
        const name = store.getAuthor();
        const author = (reply || annotation).author;
        report(save((fresh) => {
            const target = fresh.annotations.find((item) => item.id === annotation.id);
            const item = reply ? target?.replies?.find((other) => other.id === reply.id) : target;
            if (!item?.pending) throw new Error("That comment is no longer waiting for review. Reload the page.");
            if (approve) delete item.pending;
            else if (reply) target.replies = target.replies.filter((other) => other.id !== reply.id);
            else fresh.annotations = fresh.annotations.filter((other) => other.id !== annotation.id);
        }, `${name} ${approve ? "approves" : "disapproves"} comment by ${author} on ${annotation.pageTitle}`));
    }

    // Showing comments ------------------------------------------------------------------------
    function renderMessage(text, mentions) {
        const paragraph = element("p", { className: "wiki-annotation-text" });
        if (!mentions?.length) {
            paragraph.textContent = text;
            return paragraph;
        }
        const pattern = new RegExp(`(@(?:${[...mentions].sort((a, b) => b.length - a.length).map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")}))`, "giu");
        text.split(pattern).forEach((part, index) => paragraph.append(index % 2 ? element("span", { className: "wiki-mention", text: part }) : part));
        return paragraph;
    }

    function renderItem(annotation, item, reply) {
        const me = store.isSignedIn() ? nameKey(store.getAuthor()) : "";
        const mine = !item.pending && !annotation.pending && (item.mentions || []).some((name) => nameKey(name) === me);
        return element("div", { className: `wiki-annotation-item${item.pending ? " wiki-pending-item" : ""}` },
            element("div", { className: "idea-meta" }, element("strong", { text: item.author }), ` · ${formatTime(item.date)}`),
            renderMessage(item.text, item.mentions),
            item.mentions?.length ? element("div", { className: "wiki-annotation-tasks" },
                "⚑ Priority for ",
                ...item.mentions.map((name) => element("span", { className: `wiki-task-person${item.done?.[nameKey(name)] ? " wiki-task-done" : ""}`, text: name }))) : null,
            mine && !item.done?.[me] ? element("button", {
                type: "button", className: "wiki-review-approve", text: "Mark done",
                onclick: () => report(store.markTaskDone(annotation.id, item.id).then((saved) => { data = saved; render(); }))
            }) : null,
            item.pending ? element("div", { className: "wiki-review-bar" },
                element("span", { text: "Needs review" }),
                store.canReview() ? element("button", { type: "button", className: "wiki-review-approve", text: "Approve", onclick: () => moderate(true, annotation, reply) }) : null,
                store.canReview() ? element("button", { type: "button", className: "wiki-review-disapprove", text: "Disapprove", onclick: () => moderate(false, annotation, reply) }) : null) : null);
    }

    function renderCard(annotation, found) {
        const input = element("textarea", { rows: 2, maxlength: 2000, placeholder: "Reply… use @name to assign a task", "aria-label": "Reply" });
        const suggestions = attachMentions(input);
        const canDelete = store.isSignedIn() && (store.isAdmin() || nameKey(annotation.author) === nameKey(store.getAuthor()));
        return element("article", { className: "wiki-annotation-card", "data-card-id": annotation.id },
            element("blockquote", { className: "wiki-annotation-quote", text: annotation.quote }),
            found === false ? element("p", { className: "idea-meta", text: "The page has changed, so this text can't be highlighted any more." }) : null,
            renderItem(annotation, annotation, null),
            ...(annotation.replies || []).map((reply) => renderItem(annotation, reply, reply)),
            store.isSignedIn()
                ? element("form", {
                    className: "wiki-annotation-reply",
                    onsubmit: (event) => {
                        event.preventDefault();
                        if (input.value.trim()) report(addReply(annotation, input.value.trim()));
                    }
                }, input, suggestions, element("button", { type: "submit", text: "Reply" }))
                : element("a", { href: store.loginHref() }, "Log in to reply"),
            canDelete ? element("button", { type: "button", className: "wiki-link-button idea-delete", text: "Delete comment", onclick: () => removeAnnotation(annotation) }) : null);
    }

    // A list of matching people under a box while typing "@na"
    function attachMentions(input) {
        const list = element("div", { className: "wiki-mention-list", hidden: true });
        const query = () => input.value.slice(0, input.selectionStart).match(/(?:^|\s)@([^@\n]{0,24})$/);
        function choose(name) {
            const before = input.value.slice(0, input.selectionStart).replace(/@([^@\n]{0,24})$/, `@${name} `);
            input.value = before + input.value.slice(input.selectionStart);
            input.selectionStart = input.selectionEnd = before.length;
            input.focus();
            list.hidden = true;
        }
        function matches() {
            const typed = query();
            return typed ? accountNames.filter((name) => name.toLowerCase().startsWith(typed[1].toLowerCase())).slice(0, 6) : [];
        }
        input.addEventListener("input", () => {
            const names = matches();
            list.hidden = !names.length;
            list.replaceChildren(...names.map((name) => element("button", { type: "button", text: `@${name}`, onclick: () => choose(name) })));
        });
        input.addEventListener("keydown", (event) => {
            if (event.key === "Tab" && !list.hidden && matches().length) {
                event.preventDefault();
                choose(matches()[0]);
            }
        });
        return list;
    }

    const section = element("details", { className: "wiki-annotations", "data-wiki-injected": true, hidden: true });
    root.after(section);
    const popover = element("div", { className: "wiki-annotation-popover", "data-wiki-injected": true, hidden: true });
    document.body.append(popover);
    let openId = "";

    function closePopover() {
        popover.hidden = true;
        openId = "";
    }

    function openPopover(id, anchorElement) {
        const annotation = onThisPage().find((item) => item.id === id);
        if (!annotation) return;
        openId = id;
        popover.replaceChildren(
            element("button", { type: "button", className: "wiki-annotation-close", "aria-label": "Close", text: "×", onclick: closePopover }),
            renderCard(annotation));
        popover.hidden = false;
        const rect = anchorElement.getBoundingClientRect();
        popover.style.top = `${window.scrollY + rect.bottom + 6}px`;
        popover.style.left = `${Math.max(8, Math.min(window.scrollX + rect.left, window.scrollX + document.documentElement.clientWidth - popover.offsetWidth - 8))}px`;
    }

    function render() {
        clearMarks();
        if (store.isEditing()) return;
        const annotations = onThisPage();
        const placed = new Map(annotations.map((annotation) => [annotation.id, markText(annotation)]));
        const wasOpen = section.open;
        section.hidden = !annotations.length;
        section.replaceChildren(
            element("summary", { text: `Comments on this page (${annotations.length})` }),
            ...annotations.map((annotation) => renderCard(annotation, placed.get(annotation.id))));
        section.open = wasOpen;
        if (openId) {
            const mark = root.querySelector(`mark[data-annotation-id="${openId}"]`);
            if (mark) openPopover(openId, mark);
            else closePopover();
        }
    }

    root.addEventListener("click", (event) => {
        const mark = event.target.closest(`mark.${markClass}`);
        if (mark && !store.isEditing() && document.getSelection().isCollapsed) {
            event.stopPropagation();
            openPopover(mark.dataset.annotationId, mark);
        }
    });
    document.addEventListener("mousedown", (event) => {
        if (!popover.hidden && !popover.contains(event.target) && !event.target.closest(`mark.${markClass}`)) closePopover();
    });

    // Writing a comment -----------------------------------------------------------------------
    const addButton = element("button", { type: "button", className: "wiki-annotation-add", "data-wiki-injected": true, hidden: true, text: "💬 Comment" });
    document.body.append(addButton);
    let currentAnchor = null;

    function updateAddButton() {
        currentAnchor = describeSelection();
        addButton.hidden = !currentAnchor;
        if (currentAnchor) {
            addButton.style.top = `${window.scrollY + currentAnchor.rect.bottom + 6}px`;
            addButton.style.left = `${Math.max(8, window.scrollX + currentAnchor.rect.left)}px`;
        }
    }

    for (const type of ["mouseup", "keyup", "touchend"]) {
        document.addEventListener(type, () => setTimeout(updateAddButton, 0));
    }
    document.addEventListener("selectionchange", () => {
        if (document.getSelection().isCollapsed) addButton.hidden = true;
    });
    // Pressing the button shouldn't clear the selection before it's read
    addButton.addEventListener("mousedown", (event) => event.preventDefault());
    addButton.addEventListener("click", () => {
        if (!store.isSignedIn()) {
            location.href = store.loginHref();
            return;
        }
        if (currentAnchor) openComposer(currentAnchor);
    });

    function openComposer(anchor) {
        addButton.hidden = true;
        const input = element("textarea", { id: "wiki-annotation-input", rows: 4, maxlength: 2000, required: true });
        const error = element("p", { className: "wiki-dialog-error", role: "alert" });
        const dialog = element("dialog", { className: "wiki-dialog", "data-wiki-injected": true });
        const submit = element("button", { type: "submit", className: "wiki-primary", text: "Comment" });
        dialog.append(element("form", {
            method: "dialog",
            onsubmit: (event) => {
                event.preventDefault();
                const text = input.value.trim();
                if (!text) return;
                submit.disabled = true;
                addAnnotation(anchor, text).then(() => {
                    dialog.close();
                    dialog.remove();
                    document.getSelection().removeAllRanges();
                }).catch((failure) => {
                    error.textContent = failure.message;
                    submit.disabled = false;
                });
            }
        },
            element("h2", { text: "Comment on this text" }),
            element("blockquote", { className: "wiki-annotation-quote", text: anchor.quote }),
            element("label", { for: "wiki-annotation-input", text: "Your comment" }),
            input,
            attachMentions(input),
            element("p", { className: "wiki-dialog-hint", text: "Type @ and a name to assign someone a priority task. It shows highlighted in their notifications." }),
            error,
            element("div", { className: "wiki-dialog-actions" },
                element("button", { type: "button", text: "Cancel", onclick: () => { dialog.close(); dialog.remove(); } }),
                submit)));
        document.body.append(dialog);
        dialog.showModal();
        input.focus();
    }

    document.addEventListener("wiki-content-changed", render);

    Promise.all([
        fetch(dataFile, { cache: "no-cache" }).then((response) => response.ok ? response.json() : {}),
        fetch("accounts.json", { cache: "no-cache" }).then((response) => response.ok ? response.json() : {})
    ]).then(([annotationData, accounts]) => {
        data = { annotations: annotationData.annotations || [] };
        accountNames = Object.values(accounts.accounts || {}).map((account) => account.name);
        render();
        // Opening a link from Notifications (page.html#ann-…)
        const id = location.hash.slice(1);
        const mark = id.startsWith("ann-") ? root.querySelector(`mark[data-annotation-id="${id}"]`) : null;
        if (mark) {
            mark.scrollIntoView({ block: "center" });
            openPopover(id, mark);
        } else if (id.startsWith("ann-") && onThisPage().some((item) => item.id === id)) {
            section.open = true;
            section.querySelector(`[data-card-id="${id}"]`)?.scrollIntoView({ block: "center" });
        }
    }).catch(() => {
        // Comments are extra; the article still reads fine without them.
    });
})();

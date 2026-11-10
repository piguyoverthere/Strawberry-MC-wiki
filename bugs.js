(() => {
    const app = document.querySelector("#bugs-app");
    if (!app) {
        return;
    }

    const dataFile = "bugs.json";
    const statuses = [
        ["unresolved", "Unresolved"],
        ["reviewing", "Reviewing"],
        ["confirmed", "Confirmed"],
        ["resolved", "Resolved"],
        ["intended", "Intended"]
    ];
    const severities = [
        ["critical", "Critical"],
        ["major", "Major"],
        ["minor", "Minor"]
    ];
    const areas = [
        ["block", "Block or item"],
        ["mob", "Mob"],
        ["structure", "Structure"],
        ["worldgen", "World generation"],
        ["comscript", "ComScript"],
        ["wiki", "Wiki"],
        ["other", "Other"]
    ];
    // Bugs nobody has closed yet
    const openStatuses = new Set(["unresolved", "reviewing", "confirmed"]);
    const severityRank = { critical: 0, major: 1, minor: 2 };
    const label = (list, value) => (list.find(([key]) => key === value) || [value, value])[1];

    let data = { bugs: [] };
    const filters = { status: "open", severity: "", area: "", query: "", sort: "newest" };
    const openBugs = new Set();

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

    function timestamp(value, prefix = "") {
        const parsed = new Date(value);
        if (!value || Number.isNaN(parsed.getTime())) {
            return element("span", { text: `${prefix}${value || ""}` });
        }
        return element("time", {
            className: "controversy-time",
            datetime: value,
            title: parsed.toLocaleString("en-US", { dateStyle: "full", timeStyle: "short" }),
            text: `${prefix}${parsed.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}, ${parsed.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`
        });
    }

    function paragraphs(text) {
        return String(text || "").split("\n").filter((line) => line.trim()).map((line) => element("p", { text: line }));
    }

    function signedIn() {
        return Boolean(window.wikiStore?.isSignedIn());
    }

    function isAdmin() {
        return Boolean(window.wikiStore?.isAdmin());
    }

    // Reviewers can report and comment, but only admins and editors set status and severity
    function canTriage() {
        return signedIn() && !window.wikiStore.isReviewer();
    }

    // Reviewers' reports and comments wait for an admin or editor before they count
    const pendingMark = (role) => role === "reviewer" ? { pending: true } : {};

    const status = element("p", { className: "controversy-status", role: "status", "aria-live": "polite" });

    // A red "Needs review" line; admins also get Approve and Disapprove
    function reviewBar(text, onApprove, onDisapprove) {
        return element("div", { className: "wiki-review-bar" },
            element("span", { text: `Needs review · ${text}` }),
            window.wikiStore?.canReview() ? element("button", { type: "button", className: "wiki-review-approve", text: "Approve", onclick: onApprove }) : null,
            window.wikiStore?.canReview() ? element("button", { type: "button", className: "wiki-review-disapprove", text: "Disapprove", onclick: onDisapprove }) : null);
    }

    // An admin or editor approving or disapproving a reviewer's change. change(fresh) returns false when it's no longer waiting.
    function moderate(approve, what, change) {
        const name = window.wikiStore.getAuthor();
        save((fresh) => {
            if (change(fresh) === false) throw new Error("That change is no longer waiting for review. Reload the page.");
        }, `${name} ${approve ? "approves" : "disapproves"} ${what}`)
            .then(() => { status.textContent = approve ? "Approved." : "Disapproved and removed."; })
            .catch(() => {});
    }

    // Commit a change to bugs.json and show the result straight away (the live site takes a minute to publish it).
    function save(change, message) {
        const store = window.wikiStore;
        if (!store || !signedIn()) {
            location.href = store ? store.loginHref() : "login.html";
            return Promise.resolve();
        }
        status.textContent = "Saving…";
        return store.updateJson(dataFile, (fresh, role) => {
            fresh.bugs = fresh.bugs || [];
            change(fresh, role);
        }, message).then((saved) => {
            data = saved;
            render();
        }).catch((error) => {
            status.textContent = `Could not save: ${error.message}`;
            throw error;
        });
    }

    function reportBug() {
        if (!signedIn()) {
            location.href = window.wikiStore.loginHref();
            return;
        }
        const dialog = element("dialog", { className: "wiki-dialog", "data-wiki-injected": true });
        const inputs = {
            title: element("input", { id: "bug-title", type: "text", required: true, maxlength: 120 }),
            area: element("select", { id: "bug-area" }, ...areas.map(([value, text]) => element("option", { value }, text))),
            severity: element("select", { id: "bug-severity" }, ...severities.map(([value, text]) => element("option", { value, selected: value === "minor" }, text))),
            description: element("textarea", { id: "bug-description", rows: 5, required: true, maxlength: 8000 }),
            steps: element("textarea", { id: "bug-steps", rows: 5, maxlength: 8000 })
        };
        const form = element("form", { method: "dialog" },
            element("h2", { text: "Report a bug" }),
            element("label", { for: "bug-title", text: "Short summary" }), inputs.title,
            element("label", { for: "bug-area", text: "Where it happens" }), inputs.area,
            element("label", { for: "bug-severity", text: "Severity" }), inputs.severity,
            element("p", { className: "wiki-dialog-hint", text: "Critical: crashes, lost worlds or blocks progress. Major: a feature is broken. Minor: small or cosmetic." }),
            element("label", { for: "bug-description", text: "What goes wrong" }), inputs.description,
            element("label", { for: "bug-steps", text: "Steps to reproduce" }), inputs.steps,
            element("p", { className: "wiki-dialog-hint", text: "One step per line. Each line becomes a numbered step." }),
            element("div", { className: "wiki-dialog-actions" },
                element("button", { type: "button", text: "Cancel", onclick: () => dialog.close() }),
                element("button", { type: "submit", className: "wiki-primary", text: "Report bug" })));
        form.addEventListener("submit", (event) => {
            event.preventDefault();
            const values = Object.fromEntries(Object.entries(inputs).map(([key, input]) => [key, input.value.trim()]));
            dialog.close();
            const name = window.wikiStore.getAuthor();
            const now = new Date().toISOString();
            let number = 0;
            save((fresh, role) => {
                number = fresh.bugs.reduce((highest, bug) => Math.max(highest, bug.number || 0), 0) + 1;
                fresh.bugs.push({
                    id: `bug-${number}`, number, title: values.title, description: values.description, steps: values.steps,
                    area: values.area, status: "unresolved", severity: values.severity,
                    reporter: name, reported: now, updated: now, comments: [], history: [], ...pendingMark(role)
                });
            }, `${name} reports bug: ${values.title}`).then(() => {
                status.textContent = `Bug #${number} was reported.`;
                openBugs.add(`bug-${number}`);
                render();
                document.getElementById(`bug-${number}`)?.scrollIntoView({ block: "start" });
            }).catch(() => {});
        });
        dialog.append(form);
        dialog.addEventListener("close", () => dialog.remove());
        document.body.append(dialog);
        dialog.showModal();
        inputs.title.focus();
    }

    // Status and severity changes are logged in the bug's history
    function setField(bug, field, value) {
        const name = window.wikiStore.getAuthor();
        const list = field === "status" ? statuses : severities;
        save((fresh) => {
            const target = fresh.bugs.find((item) => item.id === bug.id);
            if (!target || target[field] === value) return;
            const now = new Date().toISOString();
            target.history = target.history || [];
            target.history.push({ author: name, date: now, field, from: target[field], to: value });
            target[field] = value;
            target.updated = now;
        }, `${name} sets bug ${field} to ${label(list, value).toLowerCase()}: ${bug.title}`)
            .then(() => { status.textContent = `Bug #${bug.number} is now ${label(list, value).toLowerCase()}.`; })
            .catch(() => render());
    }

    function comment(bug, textarea) {
        const text = textarea.value.trim();
        if (!text) return;
        const name = window.wikiStore.getAuthor();
        save((fresh, role) => {
            const target = fresh.bugs.find((item) => item.id === bug.id);
            if (!target) return;
            const now = new Date().toISOString();
            target.comments = target.comments || [];
            target.comments.push({ author: name, date: now, text, ...pendingMark(role) });
            target.updated = now;
        }, `${name} comments on bug: ${bug.title}`)
            .then(() => { status.textContent = "Your comment was posted."; })
            .catch(() => {});
    }

    function badge(kind, value, text) {
        return element("span", { className: `idea-badge bug-badge bug-${kind}-${value}` }, text);
    }

    function renderBug(bug) {
        const editable = signedIn();
        const picker = (field, list) => canTriage()
            ? element("label", { className: "bug-picker" }, `${field === "status" ? "Status" : "Severity"} `,
                element("select", { onchange: (event) => setField(bug, field, event.target.value) },
                    ...list.map(([value, text]) => element("option", { value, selected: bug[field] === value }, text))))
            : null;
        const steps = String(bug.steps || "").split("\n").map((line) => line.replace(/^\s*\d+[.)]\s*/, "").trim()).filter(Boolean);
        const comments = bug.comments || [];
        const history = bug.history || [];
        const box = element("textarea", { rows: 3, maxlength: 4000, placeholder: editable ? "Add a comment…" : "Log in to comment", "aria-label": "Comment" });

        const details = element("details", { className: "bug-details", open: openBugs.has(bug.id) },
            element("summary", {}, `Comments (${comments.length}) · History (${history.length + 1})`),
            comments.length ? element("ul", { className: "bug-comments" }, ...comments.map((item) =>
                element("li", { className: item.pending ? "wiki-pending-item" : null },
                    element("strong", { text: item.author }), " ", timestamp(item.date), element("div", {}, ...paragraphs(item.text)),
                    item.pending ? reviewBar(`comment by ${item.author}`,
                        () => moderate(true, `comment by ${item.author} on bug: ${bug.title}`, (fresh) => {
                            const target = fresh.bugs.find((other) => other.id === bug.id)?.comments?.find((other) => other.author === item.author && other.date === item.date);
                            if (!target?.pending) return false;
                            delete target.pending;
                        }),
                        () => moderate(false, `comment by ${item.author} on bug: ${bug.title}`, (fresh) => {
                            const list = fresh.bugs.find((other) => other.id === bug.id)?.comments || [];
                            const index = list.findIndex((other) => other.author === item.author && other.date === item.date && other.pending);
                            if (index < 0) return false;
                            list.splice(index, 1);
                        })) : null))) : null,
            element("ul", { className: "bug-history" },
                element("li", {}, "Reported by ", element("strong", { text: bug.reporter }), " ", timestamp(bug.reported)),
                ...history.map((item) => element("li", {},
                    element("strong", { text: item.author }), ` changed ${item.field} from ${label(item.field === "status" ? statuses : severities, item.from)} to ${label(item.field === "status" ? statuses : severities, item.to)} `,
                    timestamp(item.date)))),
            element("div", { className: "discussion-reply" }, box,
                element("button", { type: "button", onclick: () => editable ? comment(bug, box) : (location.href = window.wikiStore.loginHref()) }, editable ? "Post comment" : "Log in to comment")));
        details.addEventListener("toggle", () => details.open ? openBugs.add(bug.id) : openBugs.delete(bug.id));

        return element("article", { className: `idea-card bug-card bug-card-${bug.status}${bug.pending ? " wiki-pending-item" : ""}`, id: bug.id },
            element("header", { className: "idea-header" },
                element("h3", { text: `#${bug.number} ${bug.title}` }),
                element("span", { className: "idea-meta" },
                    badge("status", bug.status, label(statuses, bug.status)),
                    badge("severity", bug.severity, label(severities, bug.severity)),
                    badge("area", bug.area, label(areas, bug.area)))),
            element("p", { className: "idea-meta bug-meta" },
                "Reported by ", element("strong", { text: bug.reporter }), " · ", timestamp(bug.reported),
                bug.updated && bug.updated !== bug.reported ? element("span", {}, " · ", timestamp(bug.updated, "updated ")) : null),
            bug.pending ? reviewBar(`bug report by ${bug.reporter}`,
                () => moderate(true, `bug: ${bug.title}`, (fresh) => {
                    const target = fresh.bugs.find((other) => other.id === bug.id);
                    if (!target?.pending) return false;
                    delete target.pending;
                }),
                () => moderate(false, `bug: ${bug.title}`, (fresh) => {
                    const index = fresh.bugs.findIndex((other) => other.id === bug.id && other.pending);
                    if (index < 0) return false;
                    fresh.bugs.splice(index, 1);
                })) : null,
            element("div", { className: "idea-description" }, ...paragraphs(bug.description)),
            steps.length ? element("div", { className: "bug-steps" }, element("strong", {}, "Steps to reproduce"), element("ol", {}, ...steps.map((step) => element("li", { text: step })))) : null,
            canTriage() ? element("div", { className: "bug-controls" }, picker("status", statuses), picker("severity", severities)) : null,
            details);
    }

    function renderStats(bugs) {
        bugs = bugs.filter((bug) => !bug.pending);
        const count = (test) => bugs.filter(test).length;
        const stat = (value, text, filter) => element("button", {
            type: "button", className: `bug-stat${filter && filters.status === filter ? " bug-stat-active" : ""}`,
            onclick: () => { filters.status = filter; render(); }
        }, element("strong", { text: String(value) }), element("span", { text }));
        return element("div", { className: "bug-stats" },
            stat(bugs.length, "All bugs", "all"),
            stat(count((bug) => openStatuses.has(bug.status)), "Open", "open"),
            ...statuses.map(([value, text]) => stat(count((bug) => bug.status === value), text, value)),
            element("span", { className: "bug-stat bug-stat-critical" },
                element("strong", { text: String(count((bug) => bug.severity === "critical" && openStatuses.has(bug.status))) }),
                element("span", { text: "Open critical" })));
    }

    function render() {
        const bugs = data.bugs || [];
        const select = (key, options, allText) => element("select", { onchange: (event) => { filters[key] = event.target.value; render(); } },
            element("option", { value: "" }, allText),
            ...options.map(([value, text]) => element("option", { value, selected: filters[key] === value }, text)));
        const statusSelect = element("select", { onchange: (event) => { filters.status = event.target.value; render(); } },
            ...[["open", "Open bugs"], ["all", "All statuses"], ...statuses].map(([value, text]) => element("option", { value, selected: filters.status === value }, text)));
        const search = element("input", { type: "search", placeholder: "Search bugs…", "aria-label": "Search bugs", value: filters.query });
        search.addEventListener("input", () => { filters.query = search.value; renderList(); });
        const toolbar = element("div", { className: "controversy-toolbar" },
            element("button", { type: "button", className: "wiki-primary-button", onclick: reportBug }, signedIn() ? "+ Report a bug" : "Log in to report a bug"),
            element("label", {}, "Status ", statusSelect),
            element("label", {}, "Severity ", select("severity", severities, "Any")),
            element("label", {}, "Where ", select("area", areas, "Anywhere")),
            element("label", {}, "Sort ", element("select", { onchange: (event) => { filters.sort = event.target.value; render(); } },
                ...[["newest", "Newest reported"], ["oldest", "Oldest reported"], ["updated", "Recently updated"], ["severity", "Most severe"]]
                    .map(([value, text]) => element("option", { value, selected: filters.sort === value }, text)))),
            search);
        const list = element("div", { className: "bug-list" });

        function renderList() {
            const query = filters.query.trim().toLowerCase();
            const shown = bugs
                .filter((bug) => filters.status === "all" || (filters.status === "open" ? openStatuses.has(bug.status) : bug.status === filters.status))
                .filter((bug) => !filters.severity || bug.severity === filters.severity)
                .filter((bug) => !filters.area || bug.area === filters.area)
                .filter((bug) => !query || `#${bug.number} ${bug.title} ${bug.description} ${bug.steps} ${bug.reporter}`.toLowerCase().includes(query));
            const sorters = {
                newest: (a, b) => b.number - a.number,
                oldest: (a, b) => a.number - b.number,
                updated: (a, b) => String(b.updated).localeCompare(String(a.updated)),
                severity: (a, b) => severityRank[a.severity] - severityRank[b.severity] || b.number - a.number
            };
            shown.sort(sorters[filters.sort]);
            list.replaceChildren(...(shown.length ? shown.map(renderBug)
                : [element("p", { text: bugs.length ? "No bugs match these filters." : "No bugs reported yet." })]));
        }

        renderList();
        app.replaceChildren(renderStats(bugs), toolbar, status, list);
    }

    fetch(dataFile, { cache: "no-cache" })
        .then((response) => {
            if (!response.ok) throw new Error(`Could not load ${dataFile} (${response.status}).`);
            return response.json();
        })
        .then((loaded) => {
            data = loaded;
            window.wikiStore?.watchJson(dataFile, (fresh) => {
                data = fresh;
                window.wikiStore.keepInputs([app], render);
            });
            data.bugs = data.bugs || [];
            const id = location.hash.slice(1);
            if (id) {
                openBugs.add(id);
                filters.status = "all";
            }
            render();
            if (id) document.getElementById(id)?.scrollIntoView({ block: "start" });
        })
        .catch((error) => {
            app.replaceChildren(element("p", { text: error.message }));
        });
})();

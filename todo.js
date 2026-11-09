// To Do page: pages still marked unresolved, backed by todo.json in the repository.
(() => {
    const app = document.querySelector("#todo-app");
    if (!app) {
        return;
    }

    const dataFile = "todo.json";
    let pages = [];

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

    const status = element("p", { className: "controversy-status", role: "status" });

    async function resolve(page, button) {
        if (!window.confirm(`Mark ${page.title} as resolved? Its [UNRESOLVED] notes are removed from the page. [coming soon] notes stay.`)) return;
        button.disabled = true;
        status.textContent = "Saving…";
        try {
            pages = (await window.wikiStore.resolveTodoPage(page.file, page.title)).pages || pages;
            pages.find((item) => item.file === page.file).resolved ||= { by: window.wikiStore.getAuthor(), date: new Date().toISOString() };
            status.textContent = `${page.title} is resolved. The live site usually updates within a minute or two.`;
            render();
        } catch (error) {
            button.disabled = false;
            status.textContent = `Could not resolve this page: ${error.message}`;
        }
    }

    function renderPage(page) {
        const canResolve = window.wikiStore?.canReview();
        const button = canResolve ? element("button", { type: "button", className: "wiki-review-approve", text: "Resolve" }) : null;
        button?.addEventListener("click", () => resolve(page, button));
        return element("li", { className: "todo-item" },
            element("div", {},
                element("a", { href: page.file, text: page.title }),
                element("ul", {}, ...(page.notes || []).map((note) => element("li", { text: note })))),
            button);
    }

    function render() {
        const open = pages.filter((page) => !page.resolved);
        const resolved = pages.filter((page) => page.resolved);
        const signIn = window.wikiStore?.canReview() ? null : element("p", { className: "idea-meta" },
            window.wikiStore?.isSignedIn() ? "Only admins and editors can resolve pages." : element("a", { href: window.wikiStore?.loginHref() || "login.html", text: "Log in as an admin or editor to resolve pages." }));
        app.replaceChildren(...[status, signIn,
            element("h2", { text: `Unresolved (${open.length})` }),
            open.length ? element("ul", { className: "todo-list" }, ...open.map(renderPage)) : element("p", { text: "Everything on the list is resolved." }),
            resolved.length ? element("h2", { text: `Resolved (${resolved.length})` }) : null,
            resolved.length ? element("ul", {}, ...resolved.map((page) => element("li", {},
                element("a", { href: page.file, text: page.title }),
                ` · resolved by ${page.resolved.by} on ${new Date(page.resolved.date).toLocaleDateString("en-US", { dateStyle: "medium" })}`))) : null].filter(Boolean));
    }

    fetch(dataFile, { cache: "no-cache" }).then((response) => {
        if (!response.ok) throw new Error(`Could not load ${dataFile} (${response.status}).`);
        return response.json();
    }).then((data) => {
        pages = data.pages || [];
        render();
    }).catch((error) => {
        app.replaceChildren(element("p", { className: "wiki-dialog-error", text: error.message }));
    });
})();

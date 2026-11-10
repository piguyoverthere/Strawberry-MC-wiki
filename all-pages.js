// All Pages: every page in the search index, from A to Z.
(() => {
    const app = document.querySelector("#all-pages-app");
    if (!app || typeof pages === "undefined") {
        return;
    }

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

    const sortKey = (title) => title.replace(/^[^\p{L}\p{N}]+/u, "").replace(/^draft\]\s*/i, "");
    // Entries with a # are sections merged into another page, so they are not pages of their own
    const entries = [...new Map(pages.filter((page) => !page.href.includes("#")).map((page) => [page.href, page])).values()]
        .sort((a, b) => sortKey(a.title).localeCompare(sortKey(b.title), "en", { sensitivity: "base", numeric: true }));

    const letterOf = (page) => {
        const first = sortKey(page.title).charAt(0).toUpperCase();
        return /\p{L}/u.test(first) ? first : "#";
    };

    const count = element("p", { className: "idea-meta", role: "status" });
    const letters = element("nav", { className: "all-pages-letters", "aria-label": "Jump to letter" });
    const list = element("div");

    function render(query) {
        const words = query.toLowerCase().split(/\s+/).filter(Boolean);
        const shown = entries.filter((page) => words.every((word) => page.title.toLowerCase().includes(word)));
        const groups = new Map();
        for (const page of shown) {
            const letter = letterOf(page);
            if (!groups.has(letter)) groups.set(letter, []);
            groups.get(letter).push(page);
        }
        count.textContent = `${shown.length} of ${entries.length} pages`;
        letters.replaceChildren(...[...groups.keys()].map((letter) => element("a", { href: `#letter-${letter === "#" ? "other" : letter}`, text: letter })));
        list.replaceChildren(...[...groups].map(([letter, items]) => element("section", { className: "all-pages-group" },
            element("h2", { id: `letter-${letter === "#" ? "other" : letter}`, text: letter }),
            element("ul", {}, ...items.map((page) => element("li", {}, element("a", { href: page.href, text: page.title })))))));
    }

    const filter = element("input", {
        type: "search", placeholder: "Filter pages…", "aria-label": "Filter pages",
        oninput: () => render(filter.value)
    });
    app.replaceChildren(element("div", { className: "controversy-toolbar" }, filter), count, letters, list);
    render("");
    if (location.hash) document.querySelector(location.hash)?.scrollIntoView({ block: "start" });
})();

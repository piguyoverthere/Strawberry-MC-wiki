const newsArticles = [
];

(() => {
    const list = document.querySelector("#news-list");
    if (!list) {
        return;
    }

    const articles = [...newsArticles];

    // Articles written with the "New article" button in this browser show up here before (and right after) they are committed.
    try {
        const path = decodeURIComponent(location.pathname);
        const localPages = JSON.parse(localStorage.getItem(`strawberry-wiki-local-pages:${path.slice(0, path.lastIndexOf("/") + 1)}`) || "[]");
        for (const page of Array.isArray(localPages) ? localPages : []) {
            if (
                page &&
                page.kind === "news" &&
                typeof page.title === "string" &&
                typeof page.file === "string" &&
                /^news-[a-z0-9-]+\.html$/.test(page.file) &&
                !articles.some((article) => article.href === page.file)
            ) {
                const draft = page.href !== page.file;
                articles.push({
                    title: page.title,
                    author: String(page.author || ""),
                    date: String(page.date || ""),
                    summary: String(page.summary || ""),
                    href: draft ? `new-page.html?${new URLSearchParams({ file: page.file, title: page.title })}` : page.file,
                    draft
                });
            }
        }
    } catch {
        // The committed articles still show without browser-only drafts.
    }

    articles.sort((a, b) => b.date.localeCompare(a.date));

    function formatDate(date) {
        const parsed = new Date(`${date}T00:00:00`);
        return Number.isNaN(parsed.getTime())
            ? date
            : parsed.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    }

    list.replaceChildren();
    if (articles.length === 0) {
        const empty = document.createElement("p");
        empty.textContent = "No news yet. Be the first to write an article!";
        list.append(empty);
        return;
    }

    for (const article of articles) {
        const item = document.createElement("article");
        item.className = "news-item";

        const heading = document.createElement("h2");
        const link = document.createElement("a");
        link.href = article.href;
        link.textContent = article.title;
        heading.append(link);

        const byline = document.createElement("p");
        byline.className = "news-byline";
        byline.textContent = [article.author && `By ${article.author}`, article.date && formatDate(article.date)].filter(Boolean).join(" · ");
        if (article.draft) {
            const badge = document.createElement("span");
            badge.className = "news-draft";
            badge.textContent = "Draft in this browser";
            byline.append(" ", badge);
        }

        item.append(heading, byline);
        if (article.summary) {
            const summary = document.createElement("p");
            summary.textContent = article.summary;
            item.append(summary);
        }
        list.append(item);
    }
})();

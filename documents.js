(() => {
    const app = document.querySelector("#documents-app");
    if (!app) {
        return;
    }

    // Each PDF's older versions are read from the wiki's commit history, so replacing a file is all it takes
    // to add a new version. Add a line here for a new document.
    const pdfDocuments = [
        { title: "Strawberry MC Wiki", file: "Strawberry minecraft wiki (1).pdf" },
        { title: "MC Controversy Resolver", file: "mc-controversy-resolver.pdf" }
    ];
    const repository = { owner: "piguyoverthere", name: "Strawberry-MC-wiki", branch: "main" };
    const tokenStorageKey = "strawberry-wiki-github-token";

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

    function formatDate(value) {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    }

    function readToken() {
        try {
            return localStorage.getItem(tokenStorageKey) || "";
        } catch {
            return "";
        }
    }

    const filePath = (file) => file.split("/").map(encodeURIComponent).join("/");
    // Older versions are served from the commit that added them
    const versionHref = (file, sha) => `https://cdn.jsdelivr.net/gh/${repository.owner}/${repository.name}@${sha}/${filePath(file)}`;

    async function loadVersions(pdf) {
        const token = readToken();
        const response = await fetch(
            `https://api.github.com/repos/${repository.owner}/${repository.name}/commits?sha=${repository.branch}&path=${encodeURIComponent(pdf.file)}&per_page=100`,
            { headers: { Accept: "application/vnd.github+json", ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
        if (!response.ok) {
            throw new Error(response.status === 403 || response.status === 429
                ? "GitHub is limiting how often versions can be loaded, so only the current versions are shown. Try again in a few minutes."
                : `Could not load older versions (${response.status}).`);
        }
        return (await response.json()).map((commit) => ({ sha: commit.sha, date: commit.commit.committer?.date || commit.commit.author?.date }));
    }

    const maxUpload = 50 * 1024 * 1024;

    // A new version replaces the file, and the commit history keeps the one before it
    async function upload(pdf, chosen, button) {
        const isPdf = (await chosen.slice(0, 5).text()) === "%PDF-";
        if (!isPdf) {
            status.textContent = `${chosen.name} isn't a PDF, so it wasn't uploaded.`;
            return;
        }
        if (chosen.size > maxUpload) {
            status.textContent = `${chosen.name} is over the 50 MB limit, so it wasn't uploaded.`;
            return;
        }
        if (!window.confirm(`Upload ${chosen.name} as the new version of ${pdf.title}? The current version stays under Older versions.`)) return;
        button.disabled = true;
        button.textContent = "Uploading…";
        status.textContent = `Uploading ${chosen.name}…`;
        try {
            await window.wikiStore.uploadDocument(pdf.file, chosen, pdf.title);
            status.textContent = `${pdf.title} was updated. The new version usually opens from the live site within a minute or two.`;
            await showVersions();
            status.textContent = `${pdf.title} was updated. The new version usually opens from the live site within a minute or two.`;
        } catch (error) {
            button.disabled = false;
            button.textContent = "Upload new version";
            status.textContent = `Could not upload: ${error.message}`;
        }
    }

    function uploadControl(pdf) {
        if (!window.wikiStore?.canReview()) return null;
        const button = element("button", { type: "button", text: "Upload new version", onclick: () => input.click() });
        const input = element("input", {
            type: "file", accept: "application/pdf,.pdf", hidden: true, "aria-label": `Upload a new version of ${pdf.title}`,
            onchange: () => {
                if (input.files[0]) upload(pdf, input.files[0], button);
                input.value = "";
            }
        });
        return element("span", { className: "pdf-upload" }, button, input);
    }

    function renderDocument(pdf, versions) {
        const [current, ...older] = versions;
        return element("article", { className: "pdf-document" },
            element("h2", { text: pdf.title }),
            element("p", { className: "pdf-version pdf-version-current" },
                element("a", { className: "wiki-primary-button", href: filePath(pdf.file), target: "_blank", rel: "noopener" }, "Open latest version"),
                uploadControl(pdf),
                current ? element("span", { className: "pdf-version-date" }, `Added ${formatDate(current.date)}`) : null),
            older.length
                ? element("details", { className: "pdf-older" },
                    element("summary", {}, `Older versions (${older.length})`),
                    element("ul", {}, ...older.map((version) =>
                        element("li", {},
                            element("a", { href: versionHref(pdf.file, version.sha), target: "_blank", rel: "noopener" }, `Version from ${formatDate(version.date)}`)))))
                : element("p", { className: "pdf-version-date" }, "No older versions yet."));
    }

    const status = element("p", { className: "controversy-status", role: "status" });
    app.replaceChildren(status, ...pdfDocuments.map((pdf) => renderDocument(pdf, [])));

    function showVersions() {
        return Promise.allSettled(pdfDocuments.map(loadVersions)).then((results) => {
            const failed = results.find((result) => result.status === "rejected");
            status.textContent = failed ? failed.reason.message : "";
            app.replaceChildren(status, ...pdfDocuments.map((pdf, index) =>
                renderDocument(pdf, results[index].status === "fulfilled" ? results[index].value : [])));
        });
    }

    showVersions();
})();

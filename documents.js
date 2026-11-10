(() => {
    const app = document.querySelector("#documents-app");
    if (!app) {
        return;
    }

    // Each PDF's versions come from the wiki's commit history. pdf-versions.json adds what history can't say: each
    // version's creation date, any date set by hand, and older uploads kept beside the current file.
    // Add a line here for a new document.
    const pdfDocuments = [
        { title: "Strawberry MC Wiki", file: "Strawberry minecraft wiki (1).pdf" },
        { title: "MC Controversy Resolver", file: "mc-controversy-resolver.pdf" }
    ];
    const repository = { owner: "piguyoverthere", name: "Strawberry-MC-wiki", branch: "main" };
    const tokenStorageKey = "strawberry-wiki-github-token";
    const metadataFile = "pdf-versions.json";
    const olderFolder = "older-pdfs";
    let metadata = {};
    const histories = new Map();

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
        const date = new Date(timeOf(value));
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
    const timeOf = (value) => Date.parse(value.length === 10 ? `${value}T00:00:00` : value);
    const twoDigits = (value) => String(value).padStart(2, "0");
    const localDay = (value) => {
        const date = new Date(timeOf(value));
        return `${date.getFullYear()}-${twoDigits(date.getMonth() + 1)}-${twoDigits(date.getDate())}`;
    };

    // Newest first by creation date. A date set by hand wins; versions with neither use the day they were added.
    function versionsOf(pdf) {
        const history = histories.get(pdf.file) || [];
        if (!history.length) return [];
        const known = metadata[pdf.file] || {};
        const list = history.map((commit, index) => ({
            key: commit.sha, info: known[commit.sha] || {}, added: commit.date,
            href: index === 0 ? filePath(pdf.file) : versionHref(pdf.file, commit.sha)
        }));
        for (const [key, info] of Object.entries(known)) {
            if (info.path) list.push({ key, info, added: info.uploaded, href: filePath(info.path) });
        }
        for (const version of list) version.date = version.info.manual || version.info.created || version.added;
        return list.sort((a, b) => timeOf(b.date) - timeOf(a.date) || timeOf(b.added) - timeOf(a.added));
    }

    // Reads the creation date written inside a PDF, or "" if it doesn't have a readable one
    async function readCreationDate(file) {
        const text = new TextDecoder("latin1").decode(await file.arrayBuffer());
        const match = text.match(/\/CreationDate\s*\(D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?(?:([Z+-])(\d{2})?'?(\d{2})?)?/);
        if (match) {
            const [, year, month = "01", day = "01", hour = "00", minute = "00", second = "00", zone, zoneHour = "00", zoneMinute = "00"] = match;
            const offset = !zone ? "" : zone === "Z" ? "Z" : `${zone}${zoneHour}:${zoneMinute}`;
            const iso = `${year}-${month}-${day}T${hour}:${minute}:${second}${offset}`;
            if (!Number.isNaN(Date.parse(iso))) return iso;
        }
        const xmp = text.match(/<xmp:CreateDate>([^<]+)</)?.[1]?.trim();
        return xmp && !Number.isNaN(Date.parse(xmp)) ? xmp : "";
    }

    function saveMetadata(change, message) {
        return window.wikiStore.updateJson(metadataFile, change, message, { needsReview: false }).then((saved) => {
            metadata = saved;
        });
    }

    // Asks for a date; extra is a list of further [label, action] buttons
    function openDateDialog({ heading, hint, value, submitLabel, onSubmit, extra = [] }) {
        const input = element("input", { type: "date", id: "pdf-date-input", value, required: true });
        const error = element("p", { className: "wiki-dialog-error", role: "alert" });
        const submit = element("button", { type: "submit", className: "wiki-primary", text: submitLabel });
        const dialog = element("dialog", { className: "wiki-dialog", "data-wiki-injected": true });
        const close = () => { dialog.close(); dialog.remove(); };
        const run = (action) => {
            error.textContent = "";
            submit.disabled = true;
            Promise.resolve(action()).then(close).catch((failure) => {
                error.textContent = failure.message;
                submit.disabled = false;
            });
        };
        dialog.append(element("form", {
            method: "dialog",
            onsubmit: (event) => {
                event.preventDefault();
                if (input.value) run(() => onSubmit(input.value));
            }
        },
            element("h2", { text: heading }),
            element("label", { for: "pdf-date-input", text: "Date this version was created" }),
            input,
            element("p", { className: "wiki-dialog-hint", text: hint }),
            error,
            element("div", { className: "wiki-dialog-actions" },
                element("button", { type: "button", text: "Cancel", onclick: close }),
                ...extra.map(([label, action]) => element("button", { type: "button", text: label, onclick: () => run(action) })),
                submit)));
        document.body.append(dialog);
        dialog.showModal();
    }

    function changeDate(pdf, version) {
        const name = window.wikiStore.getAuthor();
        const store = (manual) => saveMetadata((data) => {
            const entries = data[pdf.file] = data[pdf.file] || {};
            const entry = entries[version.key] = entries[version.key] || {};
            if (manual) entry.manual = manual;
            else delete entry.manual;
        }, `${name} sets a version date of ${pdf.title}`).then(() => {
            draw();
            status.textContent = "The date was saved and the versions were re-sorted.";
        });
        openDateDialog({
            heading: `Change the date of this ${pdf.title} version`,
            hint: "Versions are listed newest first by this date.",
            value: localDay(version.date),
            submitLabel: "Save date",
            onSubmit: store,
            extra: version.info.manual ? [[version.info.created ? "Use the PDF's date" : "Remove my date", () => store("")]] : []
        });
    }

    // A PDF newer than the current version replaces it. An older one is kept beside it and listed below.
    async function upload(pdf, chosen, button, created, chosenDate) {
        const manual = created && localDay(created) === chosenDate ? "" : chosenDate;
        const newest = versionsOf(pdf)[0];
        const isOlder = Boolean(newest) && timeOf(manual || created) < timeOf(newest.date);
        const name = window.wikiStore.getAuthor();
        const stamp = `${chosenDate}-${Date.now().toString(36)}`;
        const target = isOlder ? `${olderFolder}/${pdf.file.replace(/\.pdf$/i, "").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${stamp}.pdf` : pdf.file;
        button.disabled = true;
        button.textContent = "Uploading…";
        status.textContent = `Uploading ${chosen.name}…`;
        try {
            const sha = await window.wikiStore.uploadDocument(target, chosen, `${name} uploads ${isOlder ? "an older" : "a new"} version of ${pdf.title}`);
            await saveMetadata((data) => {
                const entries = data[pdf.file] = data[pdf.file] || {};
                entries[isOlder ? target : sha] = {
                    ...(created ? { created } : {}), ...(manual ? { manual } : {}), ...(isOlder ? { path: target } : {}),
                    uploaded: new Date().toISOString(), by: name
                };
            }, `${name} records the date of a version of ${pdf.title}`);
            await showVersions();
            status.textContent = isOlder
                ? `This PDF is older than the current ${pdf.title}, so it was added under Older versions. It usually opens within a minute or two.`
                : `${pdf.title} was updated. The new version usually opens from the live site within a minute or two.`;
        } catch (error) {
            button.disabled = false;
            button.textContent = "Upload new version";
            status.textContent = `Could not upload: ${error.message}`;
        }
    }

    async function chooseUpload(pdf, chosen, button) {
        if ((await chosen.slice(0, 5).text()) !== "%PDF-") {
            status.textContent = `${chosen.name} isn't a PDF, so it wasn't uploaded.`;
            return;
        }
        if (chosen.size > maxUpload) {
            status.textContent = `${chosen.name} is over the 50 MB limit, so it wasn't uploaded.`;
            return;
        }
        const created = await readCreationDate(chosen);
        const fallback = new Date(chosen.lastModified).toISOString();
        openDateDialog({
            heading: `Upload ${chosen.name} to ${pdf.title}`,
            hint: created
                ? "Read from the PDF. Change it if it's wrong. A version older than the current one goes below it."
                : "This PDF doesn't say when it was created, so this is when the file was last changed. Correct it if needed.",
            value: localDay(created || fallback),
            submitLabel: "Upload",
            onSubmit: (date) => { upload(pdf, chosen, button, created, date); }
        });
    }

    function uploadControl(pdf) {
        if (!window.wikiStore?.canReview()) return null;
        const button = element("button", { type: "button", text: "Upload new version", onclick: () => input.click() });
        const input = element("input", {
            type: "file", accept: "application/pdf,.pdf", hidden: true, "aria-label": `Upload a new version of ${pdf.title}`,
            onchange: () => {
                if (input.files[0]) chooseUpload(pdf, input.files[0], button);
                input.value = "";
            }
        });
        return element("span", { className: "pdf-upload" }, button, input);
    }

    function changeDateButton(pdf, version) {
        return window.wikiStore?.canReview()
            ? element("button", { type: "button", className: "wiki-link-button", text: "Change date", onclick: () => changeDate(pdf, version) })
            : null;
    }

    function describeDate(version) {
        const { manual, created } = version.info;
        return `${manual || created ? "Created" : "Added"} ${formatDate(manual || version.date)}${manual ? " (set by hand)" : ""}`;
    }

    function renderDocument(pdf) {
        const [current, ...older] = versionsOf(pdf);
        return element("article", { className: "pdf-document" },
            element("h2", { text: pdf.title }),
            element("p", { className: "pdf-version pdf-version-current" },
                element("a", { className: "wiki-primary-button", href: current?.href || filePath(pdf.file), target: "_blank", rel: "noopener" }, "Open latest version"),
                uploadControl(pdf),
                current ? element("span", { className: "pdf-version-date" }, describeDate(current)) : null,
                current ? changeDateButton(pdf, current) : null),
            older.length
                ? element("details", { className: "pdf-older" },
                    element("summary", {}, `Older versions (${older.length})`),
                    element("ul", {}, ...older.map((version) =>
                        element("li", {},
                            element("a", { href: version.href, target: "_blank", rel: "noopener" }, `Version from ${formatDate(version.info.manual || version.date)}`),
                            version.info.manual ? " (set by hand) " : " ",
                            changeDateButton(pdf, version)))))
                : element("p", { className: "pdf-version-date" }, "No older versions yet."));
    }

    const status = element("p", { className: "controversy-status", role: "status" });

    function draw() {
        app.replaceChildren(status, ...pdfDocuments.map(renderDocument));
    }

    function showVersions() {
        return Promise.allSettled(pdfDocuments.map(loadVersions)).then((results) => {
            results.forEach((result, index) => {
                if (result.status === "fulfilled") histories.set(pdfDocuments[index].file, result.value);
            });
            const failed = results.find((result) => result.status === "rejected");
            status.textContent = failed ? failed.reason.message : "";
            draw();
        });
    }

    draw();
    fetch(metadataFile, { cache: "no-cache" }).then((response) => response.ok ? response.json() : {}).catch(() => ({})).then((loaded) => {
        metadata = loaded;
        return showVersions();
    }).then(() => {
        window.wikiStore?.watchJson(metadataFile, (fresh) => {
            metadata = fresh;
            draw();
        });
    });
})();

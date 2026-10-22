import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const projects = [
  {
    name: "Website refresh",
    code: "WEB",
    owner: "Maya Chen",
    initials: "MC",
    color: "purple",
    status: "Review needed",
    attention: true,
    due: "Oct 24",
    hours: 42,
    budget: 6400,
  },
  {
    name: "Customer onboarding",
    code: "ONB",
    owner: "Theo Park",
    initials: "TP",
    color: "blue",
    status: "On track",
    attention: false,
    due: "Oct 28",
    hours: 28,
    budget: 4200,
  },
  {
    name: "Mobile accessibility",
    code: "A11Y",
    owner: "Ari Morgan",
    initials: "AM",
    color: "orange",
    status: "At risk",
    attention: true,
    due: "Oct 25",
    hours: 36,
    budget: 5100,
  },
  {
    name: "Analytics workspace",
    code: "DATA",
    owner: "Sam Rivera",
    initials: "SR",
    color: "green",
    status: "On track",
    attention: false,
    due: "Nov 02",
    hours: 31,
    budget: 4800,
  },
  {
    name: "Launch checklist",
    code: "LCH",
    owner: "Jules Kim",
    initials: "JK",
    color: "pink",
    status: "Review needed",
    attention: true,
    due: "Oct 26",
    hours: 18,
    budget: 2700,
  },
  {
    name: "Design system",
    code: "DS",
    owner: "Alex Brooks",
    initials: "AB",
    color: "blue",
    status: "On track",
    attention: false,
    due: "Nov 05",
    hours: 24,
    budget: 3600,
  },
];

const escapeHTML = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ],
  );
const money = (amount) => `$${amount.toLocaleString("en-US")}`;
const sum = (rows, key) => rows.reduce((total, row) => total + row[key], 0);

function projectRows(rows) {
  return rows
    .map(
      (project) => `
    <tr data-attention="${project.attention}">
      <td><div class="project-name"><span class="project-icon ${project.color}" aria-hidden="true">${project.code}</span><span>${escapeHTML(project.name)}</span></div></td>
      <td><span class="owner"><span class="avatar" aria-hidden="true">${project.initials}</span>${escapeHTML(project.owner)}</span></td>
      <td><span class="status ${project.attention ? "attention" : "on-track"}"><span aria-hidden="true">●</span> ${project.status}</span></td>
      <td>${project.due}</td>
      <td class="numeric">${project.hours} h</td>
    </tr>`,
    )
    .join("");
}

function table(rows, exported = false) {
  return `<div class="table-wrap"><table aria-label="${exported ? "Exported projects" : "Workspace projects"}"><thead><tr><th scope="col">Project</th><th scope="col">Owner</th><th scope="col">Status</th><th scope="col">Due date</th><th scope="col" class="numeric">Planned work</th></tr></thead><tbody id="project-rows">${projectRows(rows)}</tbody></table></div>`;
}

function workspace() {
  const attentionCount = projects.filter((project) => project.attention).length;
  return `
    <section class="page-heading" id="workspace-overview"><div><p class="eyebrow">WORKSPACE / PROJECTS</p><h1>A clear view of what’s next.</h1><p class="subheading">Keep the work moving. Give the right projects your attention.</p></div><span class="workspace-label"><span class="live-dot" aria-hidden="true"></span> Sample workspace</span></section>
    <section class="metric-grid" id="workspace-summary" aria-label="Workspace summary">
      <article class="metric"><span class="metric-label">Active projects</span><strong>${projects.length}<span class="metric-note">across your team</span></strong><div class="metric-line purple-line"></div></article>
      <article class="metric"><span class="metric-label">Needs attention</span><strong>${attentionCount}<span class="metric-note">ready for a closer look</span></strong><div class="metric-line orange-line"></div></article>
      <article class="metric"><span class="metric-label">Planned work</span><strong>${sum(projects, "hours")}<span class="metric-note">hours in this workspace</span></strong><div class="metric-line green-line"></div></article>
    </section>
    <section class="panel" id="projects" data-view="all" aria-labelledby="projects-heading">
      <div class="panel-toolbar"><div><h2 id="projects-heading">Your projects <span class="count-badge" id="project-count" data-count="${projects.length}" aria-live="polite">${projects.length}</span></h2><p id="filter-description">All active projects, in one place.</p></div><div class="toolbar-actions"><button id="attention-filter" type="button" aria-pressed="false"><span class="filter-icon" aria-hidden="true">≡</span> Needs attention <span class="button-count">${attentionCount}</span></button><a id="export-projects" class="primary-button" href="/export?view=all"><span aria-hidden="true">↗</span> Export view</a></div></div>
      ${table(projects)}
      <div class="panel-footer"><span id="visible-projects" aria-live="polite">Showing ${projects.length} of ${projects.length} projects</span><span>Project data is synthetic · No account required</span></div>
    </section>`;
}

function exportPage(view) {
  const rows = projects.filter(
    (project) => view !== "attention" || project.attention,
  );
  const label = view === "attention" ? "Needs attention" : "All projects";
  return `
    <section class="page-heading"><div><p class="eyebrow">WORKSPACE / EXPORT</p><h1>The right work, ready to share.</h1><p class="subheading">A focused project summary, generated from your selected view.</p></div><a class="secondary-button" href="/">← Back to projects</a></section>
    <section class="export-banner" id="export-summary" data-export-count="${rows.length}" data-view="${view}" aria-labelledby="export-heading"><div class="success-mark" aria-hidden="true">✓</div><div><p class="eyebrow">EXPORT READY</p><h2 id="export-heading">${rows.length} projects. One focused handoff.</h2><p>View: <strong>${label}</strong> · Only the projects in this view are included below.</p></div><span class="export-tag">PROJECT SUMMARY</span></section>
    <section class="metric-grid export-metrics" id="export-details" aria-label="Export totals"><article class="metric"><span class="metric-label">Projects included</span><strong>${rows.length}<span class="metric-note">${label.toLowerCase()}</span></strong></article><article class="metric"><span class="metric-label">Planned work</span><strong>${sum(rows, "hours")}<span class="metric-note">hours to coordinate</span></strong></article><article class="metric"><span class="metric-label">Project budget</span><strong>${money(sum(rows, "budget"))}<span class="metric-note">across included projects</span></strong></article></section>
    <section class="panel" id="export-results" aria-labelledby="export-results-heading"><div class="panel-toolbar compact"><div><h2 id="export-results-heading">Included in this export <span class="count-badge">${rows.length}</span></h2><p>Generated on this server from the selected project data.</p></div><span class="view-label">${label}</span></div>${table(rows, true)}<div class="panel-footer"><span>${rows.length} of ${projects.length} workspace projects included</span><span>Sample data · Ready for your next conversation</span></div></section>`;
}

export async function startDemoServer({ port = 0 } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error("Demo port must be an integer between 0 and 65535.");
  const template = await readFile(
    new URL("./site.html", import.meta.url),
    "utf8",
  );
  const server = createServer((request, response) => {
    const headers = {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    };
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { ...headers, Allow: "GET, HEAD" });
      response.end("Method not allowed");
      return;
    }
    let url;
    try {
      url = new URL(request.url, `http://127.0.0.1:${port}`);
    } catch {
      response.writeHead(400, headers);
      response.end("Invalid URL");
      return;
    }
    if (url.pathname !== "/" && url.pathname !== "/export") {
      response.writeHead(404, headers);
      response.end("Not found");
      return;
    }
    const view = url.searchParams.get("view") ?? "all";
    if (
      (url.pathname === "/" && url.search !== "") ||
      [...url.searchParams.keys()].some((key) => key !== "view") ||
      url.searchParams.getAll("view").length > 1 ||
      !["all", "attention"].includes(view)
    ) {
      response.writeHead(400, headers);
      response.end("Unknown project view");
      return;
    }
    const exported = url.pathname === "/export";
    const html = template
      .replace(
        "{{TITLE}}",
        exported ? "Project export — Northstar" : "Projects — Northstar",
      )
      .replace("{{CONTENT}}", exported ? exportPage(view) : workspace());
    response.writeHead(200, headers);
    response.end(request.method === "HEAD" ? undefined : html);
  });

  await new Promise((resolve, reject) => {
    const onError = (error) => {
      server.close();
      server.closeAllConnections();
      reject(error);
    };
    server.once("error", onError);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", onError);
      resolve();
    });
  });
  return {
    url: `http://127.0.0.1:${server.address().port}/`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const port = Number(process.env.PORT ?? 4173);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("PORT must be an integer between 1 and 65535.");
  const server = await startDemoServer({ port });
  console.log(`Demo workspace: ${server.url}`);
}

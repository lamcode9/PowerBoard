#!/usr/bin/env node
/**
 * App Store Connect operations for PowerBoard (macOS / Mac App Store).
 *
 * Modelled on CentsCheck's asc_release_ops.js, with two deliberate differences:
 *   - every query is pinned to platform MAC_OS (the iOS filters silently return nothing here);
 *   - no jsonwebtoken/dotenv dependency — the ES256 token is signed with node:crypto, so this
 *     script runs from a clean checkout without adding anything to the repo's dependency tree.
 *
 * Auth comes from scripts/.env (ASC_KEY_ID, ASC_PRIVATE_KEY_PATH) with ASC_ISSUER_ID falling
 * back to the shared team value, exactly like fastlane/Fastfile#load_secrets. Key material is
 * never printed.
 *
 * Usage:
 *   node scripts/asc.js state                        # app record, versions, builds, readiness
 *   node scripts/asc.js builds [version]             # prerelease builds and processing state
 *   node scripts/asc.js create <version>             # create the macOS App Store version
 *   node scripts/asc.js attach <version> <build>     # attach a VALID build to the version
 *   node scripts/asc.js metadata <version> <file>    # apply listing copy from a JSON file
 *   node scripts/asc.js review <version> <file>      # app review contact + notes
 *   node scripts/asc.js screenshots <version> <dir>  # upload macOS screenshots
 *   node scripts/asc.js cancel                       # withdraw the open review submission
 *   node scripts/asc.js submit <version>             # submit for review
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, "..");
const ASC = "https://api.appstoreconnect.apple.com/v1";
const BUNDLE_ID = "com.lamonade.powerboard";
const PLATFORM = "MAC_OS";

// ---------------------------------------------------------------- auth

function loadSecrets() {
  const candidates = [
    path.join(REPO_ROOT, "scripts/.env"),
    "/Users/km/Developer/Habeat/Habeat_app/scripts/.env"
  ];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (!match) continue;
      const [, key, value] = match;
      if (!process.env[key]) process.env[key] = value.trim();
    }
  }
}

function base64url(input) {
  return Buffer.from(input).toString("base64url");
}

/** ES256 JWT, 20-minute life (Apple's ceiling), signed with the .p8 from disk. */
function token() {
  const keyId = process.env.ASC_KEY_ID;
  const issuerId = process.env.ASC_ISSUER_ID;
  const keyPath = process.env.ASC_PRIVATE_KEY_PATH;
  if (!keyId || !issuerId || !keyPath) {
    throw new Error("Missing ASC_KEY_ID, ASC_ISSUER_ID or ASC_PRIVATE_KEY_PATH.");
  }
  const resolved = path.isAbsolute(keyPath) ? keyPath : path.resolve(REPO_ROOT, keyPath);
  if (!fs.existsSync(resolved)) throw new Error(`ASC private key not found at ${resolved}`);

  const header = base64url(JSON.stringify({ alg: "ES256", kid: keyId, typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const payload = base64url(JSON.stringify({ iss: issuerId, aud: "appstoreconnect-v1", exp: now + 1190 }));
  const signer = crypto.createSign("SHA256");
  signer.update(`${header}.${payload}`);
  // Apple requires the raw r||s form (JOSE), not the DER envelope OpenSSL emits by default.
  const signature = signer.sign(
    { key: fs.readFileSync(resolved, "utf8"), dsaEncoding: "ieee-p1363" }
  );
  return `${header}.${payload}.${signature.toString("base64url")}`;
}

async function api(pathOrUrl, options = {}) {
  const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${ASC}${pathOrUrl}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token()}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(options.headers ?? {})
    }
  });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  if (!response.ok) {
    const detail =
      body?.errors?.map((e) => `[${e.status} ${e.code}] ${e.title}${e.detail ? `: ${e.detail}` : ""}`).join("\n") ??
      body?.raw ??
      "unknown error";
    const error = new Error(`ASC ${response.status} ${options.method ?? "GET"} ${url}\n${detail}`);
    error.status = response.status;
    error.errors = body?.errors ?? [];
    throw error;
  }
  return body;
}

// ---------------------------------------------------------------- reads

async function appId() {
  const data = await api(`/apps?filter[bundleId]=${BUNDLE_ID}&limit=5`);
  const app = data.data?.[0];
  if (!app) throw new Error(`No App Store Connect record for ${BUNDLE_ID}.`);
  return app;
}

async function versionOrNull(id, versionString) {
  const data = await api(
    `/apps/${id}/appStoreVersions?filter[versionString]=${versionString}&filter[platform]=${PLATFORM}&limit=5`
  );
  return data.data?.[0] ?? null;
}

async function requireVersion(id, versionString) {
  const version = await versionOrNull(id, versionString);
  if (!version) throw new Error(`No ${PLATFORM} App Store version ${versionString}. Run \`create\` first.`);
  return version;
}

async function listBuilds(id, train) {
  const filters = [`filter[app]=${id}`, `filter[preReleaseVersion.platform]=${PLATFORM}`, "sort=-uploadedDate", "limit=20"];
  if (train) filters.push(`filter[preReleaseVersion.version]=${train}`);
  const data = await api(`/builds?${filters.join("&")}`);
  return (data.data ?? []).map((build) => ({
    id: build.id,
    buildNumber: build.attributes?.version,
    state: build.attributes?.processingState,
    uploaded: build.attributes?.uploadedDate,
    expired: build.attributes?.expired
  }));
}

async function attachedBuild(versionId) {
  try {
    const data = await api(`/appStoreVersions/${versionId}/build`);
    return data.data ? { id: data.data.id, buildNumber: data.data.attributes?.version } : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- commands

async function state() {
  const app = await appId();
  console.log(`App: ${app.attributes?.name} (${app.attributes?.bundleId})  id=${app.id}`);
  console.log(`  SKU: ${app.attributes?.sku}  primaryLocale: ${app.attributes?.primaryLocale}`);

  const versions = await api(`/apps/${app.id}/appStoreVersions?filter[platform]=${PLATFORM}&limit=20`);
  console.log(`\nmacOS App Store versions (${versions.data?.length ?? 0}):`);
  for (const version of versions.data ?? []) {
    const build = await attachedBuild(version.id);
    console.log(
      `  ${version.attributes?.versionString}  state=${version.attributes?.appStoreState}` +
        `  release=${version.attributes?.releaseType}  build=${build?.buildNumber ?? "—"}  id=${version.id}`
    );
  }

  const builds = await listBuilds(app.id);
  console.log(`\nRecent macOS builds (${builds.length}):`);
  for (const build of builds.slice(0, 10)) {
    console.log(`  ${build.buildNumber}  ${build.state}${build.expired ? " (expired)" : ""}  ${build.uploaded}`);
  }

  const infos = await api(`/apps/${app.id}/appInfos?limit=10`);
  console.log(`\nApp infos (name/subtitle/category live here, not on the version):`);
  for (const info of infos.data ?? []) {
    console.log(`  id=${info.id}  state=${info.attributes?.appStoreState}`);
    const cats = await api(
      `/appInfos/${info.id}?include=primaryCategory,secondaryCategory,ageRatingDeclaration`
    );
    const included = cats.included ?? [];
    const category = (rel) => included.find((x) => x.id === cats.data?.relationships?.[rel]?.data?.id)?.id ?? "—";
    console.log(`    primaryCategory=${category("primaryCategory")}  secondaryCategory=${category("secondaryCategory")}`);
    const locs = await api(`/appInfos/${info.id}/appInfoLocalizations?limit=20`);
    for (const loc of locs.data ?? []) {
      const a = loc.attributes ?? {};
      console.log(
        `    ${a.locale}: name=${JSON.stringify(a.name)} subtitle=${JSON.stringify(a.subtitle)}` +
          ` privacyPolicyUrl=${JSON.stringify(a.privacyPolicyUrl)}`
      );
    }
  }
}

async function create(versionString) {
  const app = await appId();
  const existing = await versionOrNull(app.id, versionString);
  if (existing) {
    console.log(
      `Version ${versionString} already exists (state=${existing.attributes?.appStoreState}, id=${existing.id}) — leaving as-is.`
    );
    return existing;
  }
  const created = await api("/appStoreVersions", {
    method: "POST",
    body: JSON.stringify({
      data: {
        type: "appStoreVersions",
        attributes: { platform: PLATFORM, versionString },
        relationships: { app: { data: { type: "apps", id: app.id } } }
      }
    })
  });
  console.log(`✓ Created ${PLATFORM} App Store version ${versionString} (id=${created.data.id}).`);
  return created.data;
}

/**
 * Retitles an editable version. A build can only attach to the App Store version whose string
 * matches its CFBundleShortVersionString, and ASC allows only one editable version per platform
 * at a time — so when the two drift, renaming is the move, not creating a second version.
 */
async function rename(from, to) {
  const app = await appId();
  const version = await requireVersion(app.id, from);
  if (version.attributes?.appStoreState !== "PREPARE_FOR_SUBMISSION") {
    throw new Error(`Version ${from} is ${version.attributes?.appStoreState}, not editable.`);
  }
  await api(`/appStoreVersions/${version.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      data: { type: "appStoreVersions", id: version.id, attributes: { versionString: to } }
    })
  });
  console.log(`✓ Renamed App Store version ${from} → ${to}.`);
}

/** Sets attributes on the version itself (copyright, releaseType, …) rather than on a
 *  localization. `copyright` starts null on a new version and blocks review submission. */
async function setVersion(versionString, json) {
  const app = await appId();
  const version = await requireVersion(app.id, versionString);
  const attributes = JSON.parse(json);
  await api(`/appStoreVersions/${version.id}`, {
    method: "PATCH",
    body: JSON.stringify({ data: { type: "appStoreVersions", id: version.id, attributes } })
  });
  console.log(`✓ Set ${Object.keys(attributes).join(", ")} on ${versionString}.`);
}

async function attach(versionString, buildNumber) {
  const app = await appId();
  const version = await requireVersion(app.id, versionString);
  const builds = await listBuilds(app.id);
  const build = builds.find((b) => b.buildNumber === String(buildNumber));
  if (!build) {
    throw new Error(
      `Build ${buildNumber} not found. Available: ${builds.map((b) => `${b.buildNumber}(${b.state})`).join(", ") || "none"}`
    );
  }
  if (build.state !== "VALID") {
    throw new Error(`Build ${buildNumber} is ${build.state}, not VALID — wait for processing.`);
  }
  await api(`/appStoreVersions/${version.id}/relationships/build`, {
    method: "PATCH",
    body: JSON.stringify({ data: { type: "builds", id: build.id } })
  });
  console.log(`✓ Attached build ${buildNumber} to ${versionString}.`);
}

/**
 * Applies the listing copy. Version-scoped fields (description, keywords, what's new,
 * promotional text, support/marketing URL) go on appStoreVersionLocalizations; app-scoped
 * fields (name, subtitle, privacy policy URL) go on appInfoLocalizations — putting them on
 * the wrong resource is the single most common 409 here.
 */
async function metadata(versionString, file) {
  const copy = JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
  const app = await appId();
  const version = await requireVersion(app.id, versionString);
  const locale = copy.locale ?? "en-US";

  const versionFields = ["description", "keywords", "whatsNew", "promotionalText", "supportUrl", "marketingUrl"];
  const versionAttributes = Object.fromEntries(
    versionFields.filter((key) => copy[key] !== undefined).map((key) => [key, copy[key]])
  );
  if (Object.keys(versionAttributes).length > 0) {
    const locs = await api(`/appStoreVersions/${version.id}/appStoreVersionLocalizations?limit=50`);
    let loc = (locs.data ?? []).find((l) => l.attributes?.locale === locale);
    if (!loc) {
      const created = await api("/appStoreVersionLocalizations", {
        method: "POST",
        body: JSON.stringify({
          data: {
            type: "appStoreVersionLocalizations",
            attributes: { locale, ...versionAttributes },
            relationships: { appStoreVersion: { data: { type: "appStoreVersions", id: version.id } } }
          }
        })
      });
      loc = created.data;
      console.log(`✓ Created ${locale} version localization.`);
    } else {
      await api(`/appStoreVersionLocalizations/${loc.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          data: { type: "appStoreVersionLocalizations", id: loc.id, attributes: versionAttributes }
        })
      });
      console.log(`✓ Updated ${locale} version localization: ${Object.keys(versionAttributes).join(", ")}.`);
    }
  }

  const infoFields = ["name", "subtitle", "privacyPolicyUrl"];
  const infoAttributes = Object.fromEntries(
    infoFields.filter((key) => copy[key] !== undefined).map((key) => [key, copy[key]])
  );
  if (Object.keys(infoAttributes).length > 0 || copy.primaryCategory || copy.secondaryCategory) {
    const infos = await api(`/apps/${app.id}/appInfos?limit=10`);
    // The editable appInfo is the one that is not already on the store.
    const editable =
      (infos.data ?? []).find((i) => i.attributes?.appStoreState !== "READY_FOR_SALE") ?? infos.data?.[0];
    if (!editable) throw new Error("No editable appInfo found.");

    if (Object.keys(infoAttributes).length > 0) {
      const locs = await api(`/appInfos/${editable.id}/appInfoLocalizations?limit=20`);
      const loc = (locs.data ?? []).find((l) => l.attributes?.locale === locale);
      if (!loc) {
        await api("/appInfoLocalizations", {
          method: "POST",
          body: JSON.stringify({
            data: {
              type: "appInfoLocalizations",
              attributes: { locale, ...infoAttributes },
              relationships: { appInfo: { data: { type: "appInfos", id: editable.id } } }
            }
          })
        });
        console.log(`✓ Created ${locale} app-info localization.`);
      } else {
        await api(`/appInfoLocalizations/${loc.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            data: { type: "appInfoLocalizations", id: loc.id, attributes: infoAttributes }
          })
        });
        console.log(`✓ Updated ${locale} app-info localization: ${Object.keys(infoAttributes).join(", ")}.`);
      }
    }

    const relationships = {};
    if (copy.primaryCategory) {
      relationships.primaryCategory = { data: { type: "appCategories", id: copy.primaryCategory } };
    }
    if (copy.secondaryCategory) {
      relationships.secondaryCategory = { data: { type: "appCategories", id: copy.secondaryCategory } };
    }
    if (Object.keys(relationships).length > 0) {
      await api(`/appInfos/${editable.id}`, {
        method: "PATCH",
        body: JSON.stringify({ data: { type: "appInfos", id: editable.id, relationships } })
      });
      console.log(`✓ Set categories: ${Object.keys(relationships).join(", ")}.`);
    }
  }
}

/** Answers the age-rating questionnaire. It hangs off appInfo, not the version, and every
 *  field starts null — an unanswered questionnaire blocks submission with a vague error. */
async function ageRating(file) {
  const answers = JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
  const app = await appId();
  const infos = await api(`/apps/${app.id}/appInfos?include=ageRatingDeclaration&limit=10`);
  const declaration = (infos.included ?? []).find((x) => x.type === "ageRatingDeclarations");
  if (!declaration) throw new Error("No ageRatingDeclaration on this app.");
  await api(`/ageRatingDeclarations/${declaration.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      data: { type: "ageRatingDeclarations", id: declaration.id, attributes: answers }
    })
  });
  console.log(`✓ Answered ${Object.keys(answers).length} age-rating questions.`);
}

async function review(versionString, file) {
  const details = JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
  const app = await appId();
  const version = await requireVersion(app.id, versionString);
  let existing = null;
  try {
    const data = await api(`/appStoreVersions/${version.id}/appStoreReviewDetail`);
    existing = data.data ?? null;
  } catch {
    existing = null;
  }
  if (existing) {
    await api(`/appStoreReviewDetails/${existing.id}`, {
      method: "PATCH",
      body: JSON.stringify({ data: { type: "appStoreReviewDetails", id: existing.id, attributes: details } })
    });
    console.log("✓ Updated app review details.");
  } else {
    await api("/appStoreReviewDetails", {
      method: "POST",
      body: JSON.stringify({
        data: {
          type: "appStoreReviewDetails",
          attributes: details,
          relationships: { appStoreVersion: { data: { type: "appStoreVersions", id: version.id } } }
        }
      })
    });
    console.log("✓ Created app review details.");
  }
}

/** Uploads every PNG in `dir` (sorted by filename) into the macOS screenshot set. */
async function screenshots(versionString, dir) {
  const app = await appId();
  const version = await requireVersion(app.id, versionString);
  const locs = await api(`/appStoreVersions/${version.id}/appStoreVersionLocalizations?limit=50`);
  const loc = (locs.data ?? []).find((l) => l.attributes?.locale === "en-US") ?? locs.data?.[0];
  if (!loc) throw new Error("No version localization to hang screenshots off — run `metadata` first.");

  const sets = await api(`/appStoreVersionLocalizations/${loc.id}/appScreenshotSets?limit=20`);
  let set = (sets.data ?? []).find((s) => s.attributes?.screenshotDisplayType === "APP_DESKTOP");
  if (!set) {
    const created = await api("/appScreenshotSets", {
      method: "POST",
      body: JSON.stringify({
        data: {
          type: "appScreenshotSets",
          attributes: { screenshotDisplayType: "APP_DESKTOP" },
          relationships: {
            appStoreVersionLocalization: {
              data: { type: "appStoreVersionLocalizations", id: loc.id }
            }
          }
        }
      })
    });
    set = created.data;
    console.log("✓ Created APP_DESKTOP screenshot set.");
  }

  const existing = await api(`/appScreenshotSets/${set.id}/appScreenshots?limit=20`);
  for (const shot of existing.data ?? []) {
    await api(`/appScreenshots/${shot.id}`, { method: "DELETE" });
  }
  if ((existing.data ?? []).length > 0) console.log(`Removed ${existing.data.length} existing screenshot(s).`);

  const files = fs
    .readdirSync(dir)
    .filter((name) => name.toLowerCase().endsWith(".png"))
    .sort();
  if (files.length === 0) throw new Error(`No PNGs in ${dir}.`);

  for (const name of files) {
    const full = path.join(dir, name);
    const bytes = fs.readFileSync(full);
    const reserved = await api("/appScreenshots", {
      method: "POST",
      body: JSON.stringify({
        data: {
          type: "appScreenshots",
          attributes: { fileName: name, fileSize: bytes.length },
          relationships: { appScreenshotSet: { data: { type: "appScreenshotSets", id: set.id } } }
        }
      })
    });

    // Apple hands back one or more byte ranges; each must be PUT with its own headers.
    for (const op of reserved.data.attributes.uploadOperations) {
      const chunk = bytes.subarray(op.offset, op.offset + op.length);
      const headers = Object.fromEntries((op.requestHeaders ?? []).map((h) => [h.name, h.value]));
      const put = await fetch(op.url, { method: op.method, headers, body: chunk });
      if (!put.ok) throw new Error(`Upload chunk failed for ${name}: ${put.status} ${await put.text()}`);
    }

    await api(`/appScreenshots/${reserved.data.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        data: {
          type: "appScreenshots",
          id: reserved.data.id,
          attributes: { uploaded: true, sourceFileChecksum: crypto.createHash("md5").update(bytes).digest("hex") }
        }
      })
    });
    console.log(`✓ Uploaded ${name} (${(bytes.length / 1024).toFixed(0)} KB).`);
  }
}

/** Puts the app on the free tier worldwide. Both records are required before a first
 *  submission and neither exists by default on a new app record. */
async function priceFree() {
  const app = await appId();
  const points = await api(`/apps/${app.id}/appPricePoints?filter[territory]=USA&limit=1`);
  const free = points.data?.[0];
  if (!free || Number(free.attributes?.customerPrice) !== 0) {
    throw new Error(`Expected the first USA price point to be free, got ${free?.attributes?.customerPrice}.`);
  }
  await api("/appPriceSchedules", {
    method: "POST",
    body: JSON.stringify({
      data: {
        type: "appPriceSchedules",
        relationships: {
          app: { data: { type: "apps", id: app.id } },
          baseTerritory: { data: { type: "territories", id: "USA" } },
          manualPrices: { data: [{ type: "appPrices", id: "${new-price}" }] }
        }
      },
      included: [
        {
          type: "appPrices",
          id: "${new-price}",
          relationships: { appPricePoint: { data: { type: "appPricePoints", id: free.id } } }
        }
      ]
    })
  });
  console.log("✓ Price schedule set to free (base territory USA).");
}

async function availabilityWorldwide() {
  const app = await appId();
  const territories = await api("/territories?limit=200");
  const ids = (territories.data ?? []).map((t) => t.id);
  const refs = ids.map((id) => ({ type: "territoryAvailabilities", id: `\${${id}}` }));
  await api("https://api.appstoreconnect.apple.com/v2/appAvailabilities", {
    method: "POST",
    body: JSON.stringify({
      data: {
        type: "appAvailabilities",
        attributes: { availableInNewTerritories: true },
        relationships: {
          app: { data: { type: "apps", id: app.id } },
          territoryAvailabilities: { data: refs }
        }
      },
      included: ids.map((id) => ({
        type: "territoryAvailabilities",
        id: `\${${id}}`,
        attributes: { available: true },
        relationships: { territory: { data: { type: "territories", id } } }
      }))
    })
  });
  console.log(`✓ Available in ${ids.length} territories, and in new ones automatically.`);
}

async function submit(versionString) {
  const app = await appId();
  const version = await requireVersion(app.id, versionString);
  console.log(`Version ${versionString}: state=${version.attributes?.appStoreState} id=${version.id}`);

  const open = await api(
    `/reviewSubmissions?filter[app]=${app.id}&filter[state]=READY_FOR_REVIEW,UNRESOLVED_ISSUES&limit=10`
  );
  let submission = (open.data ?? []).find((s) => s.attributes?.platform === PLATFORM) ?? null;
  if (submission) {
    console.log(`Reusing review submission ${submission.id} (state=${submission.attributes?.state}).`);
  } else {
    const created = await api("/reviewSubmissions", {
      method: "POST",
      body: JSON.stringify({
        data: {
          type: "reviewSubmissions",
          attributes: { platform: PLATFORM },
          relationships: { app: { data: { type: "apps", id: app.id } } }
        }
      })
    });
    submission = created.data;
    console.log(`Created review submission ${submission.id}.`);
  }

  try {
    await api("/reviewSubmissionItems", {
      method: "POST",
      body: JSON.stringify({
        data: {
          type: "reviewSubmissionItems",
          relationships: {
            reviewSubmission: { data: { type: "reviewSubmissions", id: submission.id } },
            appStoreVersion: { data: { type: "appStoreVersions", id: version.id } }
          }
        }
      })
    });
    console.log("Added the version to the submission.");
  } catch (error) {
    // ASC reports "already added" in `title` with an undefined `detail`, so match on both.
    if ((error.errors ?? []).some((e) => /already|exist/i.test(`${e.title} ${e.detail} ${e.code}`))) {
      console.log("Version already part of the submission — continuing.");
    } else {
      throw error;
    }
  }

  await api(`/reviewSubmissions/${submission.id}`, {
    method: "PATCH",
    body: JSON.stringify({ data: { type: "reviewSubmissions", id: submission.id, attributes: { submitted: true } } })
  });
  console.log(`✓ Submitted ${versionString} for review (reviewSubmission ${submission.id}).`);
}

/**
 * Withdraws the open review submission so the version can take a different build. A submission
 * that is WAITING_FOR_REVIEW cannot have its build swapped underneath it — Apple pins the binary
 * at submit time — so replacing a build is always cancel → attach → submit.
 */
async function cancel() {
  const app = await appId();
  const open = await api(
    `/reviewSubmissions?filter[app]=${app.id}&filter[state]=WAITING_FOR_REVIEW,IN_REVIEW,UNRESOLVED_ISSUES,READY_FOR_REVIEW&limit=10`
  );
  const submissions = (open.data ?? []).filter((s) => s.attributes?.platform === PLATFORM);
  if (!submissions.length) {
    console.log("No open review submission to cancel.");
    return;
  }
  for (const submission of submissions) {
    const state = submission.attributes?.state;
    if (state === "READY_FOR_REVIEW") {
      // Never submitted, so there is nothing to withdraw — it is already an editable draft.
      console.log(`Review submission ${submission.id} is ${state}; left as-is.`);
      continue;
    }
    await api(`/reviewSubmissions/${submission.id}`, {
      method: "PATCH",
      body: JSON.stringify({ data: { type: "reviewSubmissions", id: submission.id, attributes: { canceled: true } } })
    });
    console.log(`✓ Cancelled review submission ${submission.id} (was ${state}).`);
  }
}

// ---------------------------------------------------------------- cli

const [command, ...args] = process.argv.slice(2);
loadSecrets();

const commands = {
  state: () => state(),
  // Ad-hoc read for the corners of the API that only matter once per release
  // (category ids, age-rating shape, price points): `asc.js get "/appCategories?limit=60"`.
  get: () => api(args[0]).then((body) => console.log(JSON.stringify(body, null, 2))),
  builds: () => appId().then((app) => listBuilds(app.id, args[0])).then((rows) => console.table(rows)),
  create: () => create(args[0]),
  rename: () => rename(args[0], args[1]),
  "set-version": () => setVersion(args[0], args[1]),
  attach: () => attach(args[0], args[1]),
  metadata: () => metadata(args[0], args[1]),
  agerating: () => ageRating(args[0]),
  review: () => review(args[0], args[1]),
  screenshots: () => screenshots(args[0], args[1]),
  "price-free": () => priceFree(),
  availability: () => availabilityWorldwide(),
  cancel: () => cancel(),
  submit: () => submit(args[0])
};

if (!commands[command]) {
  console.error(`Unknown command ${JSON.stringify(command)}. One of: ${Object.keys(commands).join(", ")}`);
  process.exit(1);
}

commands[command]().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

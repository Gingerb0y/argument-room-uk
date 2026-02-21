// =======================
// 1) CONFIG: PUT YOUR KEYS HERE
// =======================
const SUPABASE_URL = "https://sretysfdmwhdowrvcvey.supabase.co";
const SUPABASE_KEY = "sb_publishable_v1ZzsxEj0iTGWG2SLQuMTw_Qy4ux91a";

// Supabase client (use CDN global)
const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// =======================
// 2) HELPERS
// =======================
function qs(name) {
  return new URLSearchParams(window.location.search).get(name);
}
function fmtDate(iso) {
  try { return new Date(iso).toLocaleDateString("en-GB", { year:"numeric", month:"short", day:"2-digit" }); }
  catch { return ""; }
}
function clamp(n, min, max){ return Math.max(min, Math.min(max, n)); }
function escapeHtml(str){
  return (str ?? "").replace(/[&<>"']/g, s => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[s]));
}

// =======================
// 3) AUTH UI (shared across pages)
// =======================
let authMode = "login"; // or "signup"

function initAuthUI() {
  const modal = document.getElementById("authModal");
  const btnLogin = document.getElementById("btnLogin");
  const btnSignup = document.getElementById("btnSignup");
  const btnLogout = document.getElementById("btnLogout");

  const closeBtn = document.getElementById("authClose");
  const authTitle = document.getElementById("authTitle");
  const form = document.getElementById("authForm");
  const email = document.getElementById("authEmail");
  const pass = document.getElementById("authPassword");
  const userLabel = document.getElementById("usernameLabel");
  const username = document.getElementById("authUsername");
  const msg = document.getElementById("authMsg");
  const switchMode = document.getElementById("switchMode");

  function open(mode){
    authMode = mode;
    msg.textContent = "";
    email.value = "";
    pass.value = "";
    username.value = "";
    authTitle.textContent = mode === "signup" ? "Sign up" : "Log in";
    const showUser = mode === "signup";
    userLabel.classList.toggle("hidden", !showUser);
    username.classList.toggle("hidden", !showUser);
    modal.classList.remove("hidden");
    modal.setAttribute("aria-hidden", "false");
  }
  function close(){
    modal.classList.add("hidden");
    modal.setAttribute("aria-hidden", "true");
  }

  if (btnLogin) btnLogin.onclick = () => open("login");
  if (btnSignup) btnSignup.onclick = () => open("signup");
  if (closeBtn) closeBtn.onclick = () => close();

  if (switchMode) {
    switchMode.onclick = (e) => {
      e.preventDefault();
      open(authMode === "signup" ? "login" : "signup");
      switchMode.textContent = authMode === "signup" ? "Already have an account? Log in" : "Need an account? Sign up";
    };
    switchMode.textContent = "Need an account? Sign up";
  }

  // Close on background click
  if (modal) {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) close();
    });
  }

  // Logout
  if (btnLogout) {
    btnLogout.onclick = async () => {
      await client.auth.signOut();
      location.reload();
    };
  }

  // Session-aware buttons
  client.auth.getSession().then(({ data }) => {
    const session = data.session;
    if (btnLogout) btnLogout.classList.toggle("hidden", !session);
    if (btnLogin) btnLogin.classList.toggle("hidden", !!session);
    if (btnSignup) btnSignup.classList.toggle("hidden", !!session);
  });

  // Auth submit
  if (form) {
    form.onsubmit = async (e) => {
      e.preventDefault();
      msg.textContent = "Working…";

      const em = email.value.trim();
      const pw = pass.value.trim();
      const un = username.value.trim();

      try {
        if (authMode === "signup") {
          if (!un || un.length < 3) {
            msg.textContent = "Username must be at least 3 characters.";
            return;
          }

          // 1) Create auth user
          const { data, error } = await client.auth.signUp({ email: em, password: pw });
          if (error) throw error;

          // 2) Create profile row (requires auth.uid() = id policy)
          // If email confirmation is ON, user may not have a session immediately.
          // We handle both cases:
          const user = data.user;
          if (!user) {
            msg.textContent = "Check your email to confirm sign up.";
            return;
          }

          const { error: pErr } = await client.from("profiles").insert({
            id: user.id,
            username: un,
            reputation: 0,
            level: "New Debater"
          });

          // If confirm email is ON, insert may fail due to no session; that’s OK.
          if (pErr) {
            msg.textContent = "Account created. If prompted, confirm your email then log in.";
            return;
          }

          msg.textContent = "Account created. If email confirmation is enabled, confirm then log in.";
        } else {
          const { error } = await client.auth.signInWithPassword({ email: em, password: pw });
          if (error) throw error;
          msg.textContent = "Logged in.";
          setTimeout(() => location.reload(), 400);
        }
      } catch (err) {
        msg.textContent = err?.message || "Auth error.";
      }
    };
  }
}

// =======================
// 4) HOMEPAGE
// =======================
async function loadHomepage() {
  const elEsc = document.getElementById("escalatingList");
  const elFlash = document.getElementById("flashpointsList");
  if (!elEsc || !elFlash) return;

  // Escalating Now = highest velocity among active debates
  const { data: esc, error: escErr } = await client
    .from("stories")
    .select("id,title,slug,category,heated_score,velocity_score,status,published_at")
    .eq("status", "active")
    .order("velocity_score", { ascending: false })
    .limit(6);

  if (escErr) {
    elEsc.innerHTML = `<div class="muted">Error loading: ${escapeHtml(escErr.message)}</div>`;
  } else {
    elEsc.innerHTML = (esc || []).map(s => storyCard(s, true)).join("") || `<div class="muted">No debates yet.</div>`;
  }

  // Flashpoints = highest heat (active first; if empty, show frozen/archived too)
  const { data: flash, error: flashErr } = await client
    .from("stories")
    .select("id,title,slug,category,heated_score,velocity_score,status,published_at")
    .order("heated_score", { ascending: false })
    .limit(6);

  if (flashErr) {
    elFlash.innerHTML = `<div class="muted">Error loading: ${escapeHtml(flashErr.message)}</div>`;
  } else {
    elFlash.innerHTML = (flash || []).map(s => storyCard(s, false)).join("") || `<div class="muted">No debates yet.</div>`;
  }
}

function storyCard(s, showRising) {
  const rising = showRising && Number(s.velocity_score || 0) >= 10;
  const status = (s.status || "active").toUpperCase();
  return `
    <div class="item">
      <div class="item__top">
        <a class="item__title" href="story.html?slug=${encodeURIComponent(s.slug)}">${escapeHtml(s.title)}</a>
        <div class="item__meta">
          <span class="pill">${escapeHtml(s.category)}</span>
          <span class="pill pill--ghost">${escapeHtml(status)}</span>
          ${rising ? `<span class="rising">▲ Rising</span>` : ``}
        </div>
      </div>
      <div class="muted">Published ${fmtDate(s.published_at)} • Heat ${Number(s.heated_score||0)} • Momentum ${Number(s.velocity_score||0).toFixed(1)}</div>
    </div>
  `;
}

// =======================
// 5) LEADERBOARD
// =======================
async function loadLeaderboard() {
  const el = document.getElementById("leaderboard");
  if (!el) return;

  const { data, error } = await client
    .from("profiles")
    .select("username,reputation,level")
    .order("reputation", { ascending: false })
    .limit(10);

  if (error) {
    el.innerHTML = `<div class="muted">Error loading leaderboard.</div>`;
    return;
  }

  const rows = (data || []).map((u, i) => `
    <div class="lbrow">
      <div class="lbrow__left">
        <div class="rank">#${i+1}</div>
        <div>
          <div style="font-weight:900">${escapeHtml(u.username)}</div>
          <div class="muted">${escapeHtml(u.level || "New Debater")}</div>
        </div>
      </div>
      <div class="level">${Number(u.reputation||0)} rep</div>
    </div>
  `).join("");

  el.innerHTML = rows || `<div class="muted">No contributors yet.</div>`;
}

// =======================
// 6) STORY PAGE
// =======================
let commentsChannel = null;

async function loadStoryPage() {
  const slug = qs("slug");
  if (!slug) return;

  const titleEl = document.getElementById("storyTitle");
  const catEl = document.getElementById("storyCategory");
  const statusEl = document.getElementById("storyStatus");
  const dateEl = document.getElementById("storyDate");
  const aEl = document.getElementById("opinionA");
  const bEl = document.getElementById("opinionB");

  const closedBanner = document.getElementById("closedBanner");
  const commentFormWrap = document.getElementById("commentFormWrap");
  const authHint = document.getElementById("authHint");

  const heatedFill = document.getElementById("heatedFill");
  const heatedText = document.getElementById("heatedText");
  const velocityFill = document.getElementById("velocityFill");
  const velocityText = document.getElementById("velocityText");

  // Fetch story
  const { data: story, error: sErr } = await client
    .from("stories")
    .select("*")
    .eq("slug", slug)
    .single();

  if (sErr || !story) {
    if (titleEl) titleEl.textContent = "Debate not found.";
    return;
  }

  // Opinions
  const { data: ops } = await client
    .from("opinions")
    .select("side,body")
    .eq("story_id", story.id);

  const opA = (ops || []).find(x => x.side === "A");
  const opB = (ops || []).find(x => x.side === "B");

  titleEl.textContent = story.title;
  catEl.textContent = story.category;
  statusEl.textContent = (story.status || "active").toUpperCase();
  dateEl.textContent = `Published ${fmtDate(story.published_at)}`;

  aEl.innerHTML = escapeHtml(opA?.body || "Not available yet.").replace(/\n/g,"<br>");
  bEl.innerHTML = escapeHtml(opB?.body || "Not available yet.").replace(/\n/g,"<br>");

  // Scoreboard UI
  const heat = Number(story.heated_score || 0);
  const vel = Number(story.velocity_score || 0);
  const heatPct = clamp(heat, 0, 100);
  const velPct = clamp(vel * 3, 0, 100); // scale for display

  heatedFill.style.width = `${heatPct}%`;
  heatedFill.style.background = heat > 75 ? "var(--accentDeep)" : "var(--accent)";
  heatedText.textContent = `Heated Score: ${heat} ${heat > 90 ? "(Flashpoint)" : heat > 75 ? "(Escalating)" : ""}`.trim();

  velocityFill.style.width = `${velPct}%`;
  velocityText.textContent = `Momentum: ${vel.toFixed(1)}`;

  // Auth status
  const { data: sessData } = await client.auth.getSession();
  const session = sessData.session;

  const isClosed = story.status !== "active";
  closedBanner.classList.toggle("hidden", !isClosed);

  if (!session) {
    authHint.textContent = "Log in to post. No anonymous posting.";
    commentFormWrap.classList.add("hidden");
  } else if (isClosed) {
    authHint.textContent = "Debate is closed. Comments are frozen.";
    commentFormWrap.classList.add("hidden");
  } else {
    authHint.textContent = "Post a structured argument (A / B / Both).";
    commentFormWrap.classList.remove("hidden");
    hookPostComment(story.id);
  }

  // Load comments + realtime
  await renderComments(story.id);

  if (commentsChannel) {
    client.removeChannel(commentsChannel);
    commentsChannel = null;
  }

  commentsChannel = client
    .channel("comments-live")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "comments", filter: `story_id=eq.${story.id}` },
      async () => { await renderComments(story.id); }
    )
    .subscribe();
}

async function renderComments(storyId) {
  const list = document.getElementById("commentsList");
  if (!list) return;

  const { data, error } = await client
    .from("comments")
    .select("id,side,content,created_at,profiles(username,level)")
    .eq("story_id", storyId)
    .eq("is_hidden", false)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    list.innerHTML = `<div class="muted">Error loading comments.</div>`;
    return;
  }

  list.innerHTML = (data || []).map(c => `
    <div class="comment">
      <div class="comment__top">
        <div>
          <span class="comment__user">${escapeHtml(c.profiles?.username || "User")}</span>
          <span class="comment__badge">• ${escapeHtml(c.profiles?.level || "New Debater")}</span>
          <span class="comment__badge">• ${fmtDate(c.created_at)}</span>
        </div>
        <span class="comment__side">${escapeHtml(c.side)}</span>
      </div>
      <div class="comment__body">${escapeHtml(c.content)}</div>
    </div>
  `).join("") || `<div class="muted">No arguments yet. Be the first.</div>`;
}

function hookPostComment(storyId) {
  const btn = document.getElementById("postBtn");
  if (!btn || btn.dataset.bound === "1") return;
  btn.dataset.bound = "1";

  btn.onclick = async () => {
    const side = document.getElementById("positionSelect").value;
    const content = document.getElementById("commentInput").value.trim();
    const msg = document.getElementById("postMsg");

    if (!content || content.length < 10) {
      msg.textContent = "Write at least 10 characters.";
      return;
    }

    btn.disabled = true;
    const prev = btn.textContent;
    btn.textContent = "Posting…";
    msg.textContent = "";

    try {
      const { data: sessData } = await client.auth.getSession();
      const user = sessData.session?.user;
      if (!user) throw new Error("Not logged in.");

      // Insert comment
      const { error } = await client.from("comments").insert({
        story_id: storyId,
        author_id: user.id,
        side,
        content
      });
      if (error) throw error;

      // Clear UI
      document.getElementById("commentInput").value = "";
      msg.textContent = "Posted.";

      // Reputation bump (simple MVP): +5 per comment
      // Note: Your RLS allows users to update their own profile, but we didn’t expose select-all.
      // We update via RPC later. For MVP we skip automatic rep update to avoid policy complexity.
    } catch (e) {
      msg.textContent = e?.message || "Post failed.";
    } finally {
      btn.disabled = false;
      btn.textContent = prev;
    }
  };
}

// =======================
// 7) ARCHIVE
// =======================
async function loadArchive() {
  const list = document.getElementById("archiveList");
  const fy = document.getElementById("filterYear");
  const fc = document.getElementById("filterCategory");
  const btn = document.getElementById("filterBtn");
  if (!list || !fy || !fc || !btn) return;

  // Populate year dropdown from story dates
  const { data: yearsData } = await client
    .from("stories")
    .select("published_at")
    .order("published_at", { ascending: false })
    .limit(500);

  const years = Array.from(new Set((yearsData || [])
    .map(r => (r.published_at ? new Date(r.published_at).getFullYear() : null))
    .filter(Boolean)))
    .sort((a,b)=>b-a);

  fy.innerHTML = `<option value="">All years</option>` + years.map(y=>`<option value="${y}">${y}</option>`).join("");

  async function run() {
    list.innerHTML = `<div class="muted">Loading…</div>`;

    let q = client
      .from("stories")
      .select("id,title,slug,category,heated_score,velocity_score,status,published_at")
      .in("status", ["frozen","archived"])
      .order("published_at", { ascending: false })
      .limit(200);

    const cat = fc.value;
    const year = fy.value;

    if (cat) q = q.eq("category", cat);
    if (year) {
      const start = new Date(Number(year), 0, 1).toISOString();
      const end = new Date(Number(year)+1, 0, 1).toISOString();
      q = q.gte("published_at", start).lt("published_at", end);
    }

    const { data, error } = await q;

    if (error) {
      list.innerHTML = `<div class="muted">Error loading archive.</div>`;
      return;
    }

    list.innerHTML = (data || []).map(s => storyCard(s, false)).join("") || `<div class="muted">No archived debates yet.</div>`;
  }

  btn.onclick = run;
  await run();
}

// =======================
// 8) NEWSLETTER
// =======================
function initNewsletter() {
  const form = document.getElementById("newsletterForm");
  const email = document.getElementById("newsletterEmail");
  const msg = document.getElementById("newsletterMsg");
  if (!form || !email || !msg) return;

  form.onsubmit = async (e) => {
    e.preventDefault();
    msg.textContent = "Saving…";
    const val = email.value.trim().toLowerCase();

    const { error } = await client.from("subscribers").insert({ email: val });
    if (error) {
      msg.textContent = error.message.includes("duplicate") ? "Already subscribed." : "Could not subscribe.";
      return;
    }
    msg.textContent = "Subscribed.";
    email.value = "";
  };
}

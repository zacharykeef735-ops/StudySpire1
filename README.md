# StudySpire1 — Organizations & Schools 🏫

**A distinct school-management version of StudySpire. No AWS.** The original `StudySpire` repo is not changed by work in this repo.

## New: School classroom workspace (October 2026)

Open **Organizations & Schools**, choose a school, and press **Open classroom** beside a class. This is separate from the regular StudySpire repo.

- **Principals / platform Owners:** enroll or remove existing school teachers and students into each class. Classes themselves remain principal/Owner-created; teachers cannot create classes.
- **Teachers assigned to a class:** post assignments (instructions, deadline, maximum score), publish class announcements, review student submissions, and give points-based grades with feedback.
- **Students enrolled in a class:** read class updates and assignments, submit or revise written work before it is graded, see their own scores and teacher feedback, and export class due dates to their calendar.
- **Grade overview:** teachers see class members' percentages across graded submissions only; students see their own. This is a basic class grade summary, not an official report card.
- **Privacy:** student work is returned only to the enrolled student and authorized class teacher/school leadership. The browser never directly reads the private school tables. Organization admins are not automatically allowed into class gradebooks.
- **Smart Planner:** the same personal, device-local Planner module is available in both repos with deadlines, spaced review, progress, and backups. Its contents are separate from official classroom assignments.

Database setup for a new StudySpire1 project:

1. Install the original StudySpire schema and earlier migrations in their documented order.
2. Apply studyspire1-organizations-schools.sql.
3. Apply studyspire1-academics.sql.
4. Verify the new tables have RLS enabled and no direct anon/authenticated table SELECT grants. The published classroom RPCs require a verified account and server-side class/school role checks.

The classroom migration was applied to the currently connected Supabase project on October 29, 2026. **StudySpire and StudySpire1 still share that backend and Cloud logins**; use a dedicated Supabase project before storing production student records. No AWS is needed. Smoke test: run node --test tests/studyspire-planner.test.cjs.

Parent portals, Google Classroom sync, district analytics, file attachments, and a formal cumulative gradebook are future work, not functioning features today.

---

## New: owner-managed school networks

The platform **Owner / Co-Owner** can create multiple organizations (districts, school networks), add schools to each, appoint and remove **organization administrators**, appoint **school principals**, and create classes. Organization administrators manage only the organizations they are appointed to, including school creation and appointing principals. Principals manage teachers/students in their assigned schools and can create classes. Teachers and students can see only the schools they belong to; teachers **cannot create classes**.

School roles are **separate from platform roles**: appointing someone as an organization administrator does **not** promote them to platform Owner/Admin. Administrators and principals cannot manage another organization's schools or memberships. The permissions are checked by SQL functions on the server, not by the interface.

### Open the new dashboard

1. Open StudySpire1 and sign in to **StudySpire Cloud**.
2. As an existing platform Owner / Co-Owner, select **🏫 Organizations & Schools** in the navigation, top bar, or dashboard quick actions.
3. Create an **organization**, e.g. `Central School District`, code `central-district`.
4. Under that organization, add a **school**, e.g. `Central High School`, code `central-high`.
5. Under **Organization administrators**, enter an **existing StudySpire username** and appoint an administrator.
6. Choose a school and enter an existing username to appoint a **principal**.
7. The principal may enroll teachers/students and create class names from their own school view.

Permissions recap:

| Role | Create org | Create school | Appoint org admin | Appoint principal | Enroll teacher/student | Create class |
|---|---|---|---|---|---|---|
| Platform Owner / Co-Owner | Yes | Yes | Yes | Yes | Yes | Yes |
| Organization admin | No | Own org only | No | Own org only | Own org schools | No |
| School principal | No | No | No | No | Own school only | Own school only |
| Teacher / student | No | No | No | No | No | No |

**Database:** `studyspire1-organizations-schools.sql` creates the school tables, private roster, per-organization role assignments, and authenticated SQL RPCs. The migration is installed in the currently connected Supabase project. It creates only new `ss_organization*`, `ss_school*`, and `ss_schools` structures; it does not change the original account or moderation tables. The Owner dashboard will show a setup error if these functions are missing on another database.

**Data isolation caveat:** `cloud-config.js` currently points to the **same Supabase project** as the original StudySpire website. StudySpire1's organizations are logically separated by role and school scope, **but logins and the backend are still shared between websites**. To have entirely independent users and student records, create a new Supabase project, run the original migrations in its documented order and then the StudySpire1 school migration, and change **only StudySpire1's** `cloud-config.js` public URL/publishable key. Never place service-role or secret keys in that file.

**Deployment:** This remains a static website that can use GitHub Pages or Cloudflare Pages. No AWS, GPU, Ollama, or AWS Amplify configuration is needed. The original StudySpire Cloudflare AI and optional browser AI remain unchanged.

**Current scope:** School management, school memberships, principal-created classes, class enrollment, assignments, written submissions, teacher grading, class announcements, and basic graded-work averages are implemented. Parent portals, formal transcripts, Google Classroom integration, and district-wide analytics are not yet connected. The school system needs live multi-user and privacy testing before production use.

---

# StudySpire 📚

**A browser-based study workspace with personal study tools, optional Supabase cloud accounts, role-based moderation, and an experimental on-device AI assistant.**

StudySpire is a static web application: the main interface lives in `index.html`, with account and cloud features in `cloud.js`. It can be hosted using GitHub Pages without running a custom web server. Supabase provides cloud authentication, study-data synchronization, moderation, and password recovery.

> **Project status: beta.** The features described below are present in the repository and the database migrations have been applied to the connected project, but end-to-end account recovery, role authorization, cross-device sync, and AI downloads still need testing in real browsers before production use.

## Contents

- [How to use StudySpire](#how-to-use-studyspire)
- [What StudySpire does](#what-studysummit-does)
- [Progress, focus and quick actions](#progress-focus-and-quick-actions)
- [How it works](#how-it-works)
- [Accounts and cloud synchronization](#accounts-and-cloud-synchronization)
- [Cloud friends and messaging](#cloud-friends-and-messaging)
- [Roles and dashboards](#roles-and-dashboards)
- [Password recovery](#password-recovery)
- [Browser AI](#browser-ai)
- [Installation and deployment](#installation-and-deployment)
- [Supabase setup and migrations](#supabase-setup-and-migrations)
- [Repository files](#repository-files)
- [Security and limitations](#security-and-limitations)
- [Troubleshooting](#troubleshooting)

<!-- STUDYSPIRE_GUIDE_START -->
## How to use StudySpire

Welcome! You can use most study tools right in your browser. Sign in to a Cloud account if you want account-based study storage, messaging, and staff features.

### 1. Find your way around
- **AI Tutor** is for questions, explanations, and help with practice.
- **Home** shows your study tools. **Assignments** includes calendar and study planning, while **Documents** combines notes and saved files.
- **Mini** is the small floating ✦ assistant. Open it from its launcher; if hidden, enable it in **Settings → AI & Mini**.
- **Help (?)** in the top-right opens this guide any time.

### 2. Ask the AI tutor
1. Open **AI Tutor** and type a question or upload a worksheet.
2. For on-device AI, go to **Settings → AI & Mini**, choose an available model, and select **Load browser AI**.
3. Wait for the first model download and initialization, then ask your question. Smaller models work on more devices.
4. If loading fails, open **Health** for a WebGPU check or try the smallest model. Browser AI is experimental.

### 3. Make flashcards, notes, and plans
1. Open **Flashcards** in the sidebar or Home to create and practice cards.
2. Use **Documents** to create notes and manage saved documents, and **Assignments** to organize tasks, due dates, and study planning.
3. Mark completed tasks and practice cards to build your study-progress history.
4. Use **Progress** in the top bar for goals, study streaks, and the Quick Focus timer.

### 4. Sign in and protect your work
1. Open **Account** in the top-right to create a username/password Cloud account or sign in.
2. A username account does not require an email. Use a unique username and a strong password.
3. Use **Manage account** to switch accounts or change your password while signed in.
4. If you forget a username-account password, select **Forgot password?** and request a six-digit, Owner-approved recovery code.
5. Export important work as a backup. Browser-local work can disappear if your browser storage is cleared.

### 5. Message friends and share flashcards
1. Sign into Cloud, open **Messages & friends**, and search by an exact StudySpire username.
2. Send a friend request. The recipient must **Accept** before either person can chat.
3. Choose an accepted friend to exchange messages or share a copy of flashcards.
4. Use **Block** or **Report** when necessary. Messaging isn't end-to-end encrypted; avoid sharing private information.

### Profile pictures and reports
1. Sign in to your Cloud account, open **Account → Profile picture**, or click your avatar at the top-right.
2. Choose a JPG, PNG, or WebP image. StudySpire crops it to a square WebP thumbnail before uploading; the photo is visible to other signed-in users.
3. Select **Save picture** to upload it, or **Remove picture** to restore your initials.
4. To view or report another user's picture, open **Messages & friends**, search for their exact username, and select **View / report picture**. Choose **Report this profile picture**, write a reason, then send it.
5. **Moderators** can review reports and remove Student pictures. **Admins** can also restrict uploads by Students and Moderators. **Owners** can manage all other accounts' pictures and restrictions. Restricted accounts can remove their own pictures but cannot upload new ones.
6. Staff review reports under **Cloud staff → Profile pictures**. Reports include a snapshot of the reported image until reviewed. Upload restrictions and moderation actions are checked by Supabase, not just the website controls.

### 6. Handy shortcuts and troubleshooting
- **Ctrl/⌘ + K:** Open Quick Actions to find a feature.
- **Ctrl/⌘ + B:** Collapse or expand the sidebar.
- **Ctrl + Shift + Space:** Toggle the floating Mini, when enabled.
- **Health:** See browser GPU compatibility, cloud connection, and AI loading errors.
- If the site looks outdated, refresh after a deployment. If the AI won't load, check hardware acceleration, your connection, and the smallest model.
<!-- STUDYSPIRE_GUIDE_END -->

## What StudySpire does

StudySpire combines study and productivity features in a dark-themed browser interface. The application includes study workspace features such as notes, flashcards, study planning and tasks, saved study content, personalization, and an AI study assistant. Available features can vary by page and browser capabilities.

You can use browser-local study features without creating a cloud account. A StudySpire cloud account adds username/password sign-in, personal cloud study storage, and access to the appropriate dashboard for a user's role.

**Two distinct kinds of accounts exist:**

- **Cloud accounts:** Supabase-backed identities. New accounts use a username and password without an email address. Each account has its own study data and server-assigned permissions.
- **Older email accounts:** Existing Supabase email/password accounts remain available through the **Older email account** sign-in option.
  
An older browser-local demo administrator is **not** the same as a Supabase Cloud Owner.

### The StudySpire home dashboard

The refreshed StudySpire home is the first screen you see. It keeps the original sidebar and has a calm blue-and-lavender hero with the StudySpire spire-and-book icon and the original **Academic AI** subtext. The five distinct study-tool cards open AI Tutor, Flashcards, Assignments, Documents, and Friends; there are no paid upgrades. **Today's Plan** uses assignments and task status from your current profile, and the focus panel opens the existing working focus timer. Friends and Documents take you to your own account's content; the home page does not invent sample classmates, assignments, or files. Mini stays reachable through the small floating icon, and **? Help** opens the on-site guide pulled from this README. The redundant Study Center menu link is removed, but the original study tools, account, AI, messaging, and staff screens remain available. Study Planner is available in Assignments; Cloud Drive and Notes are combined under Documents.

## Cloud profile pictures and moderation

Signed-in StudySpire users can upload a small profile photo. The browser converts the selected JPG/PNG/WebP to a square WebP image (up to 64 KB) and stores it in a private Supabase table using `ss_avatar_set`. Photos can be viewed by other signed-in accounts through restricted read-only RPCs. The photo and its moderation status are **not stored in local study progress or browser-local mock accounts**. There is no public Storage bucket or direct `INSERT/UPDATE` access for browser roles. Only the account holder can upload or remove their photo; new uploads are blocked when an Admin/Owner has restricted them.

Any signed-in account, including a Moderator, can report another user's current photo by exact username, with a reason. Reports include a snapshot of that photo for the staff inbox. Reports cannot target your own account; duplicates for the same picture revision and excessive reporting are blocked. Moderators can review/remove Student photos, Admins can handle Student/Moderator photos and restrict uploads, and Owners can handle any other account. A staff member cannot remove an unreported newer version while reviewing an older report. Reports and restrictions are permission-checked inside Supabase and audited where staff act. After reviewing a report, the stored snapshot is cleared. The migration is documented in `profile-picture-moderation-migration.sql`.

## Verified roles, bios and account deletion

### Visible staff titles and bios

StudySpire displays **👑 Owner**, **🛡 Admin**, and **⚑ Moderator** badges alongside the matching accounts in Cloud messaging, friends, profiles and the account header. The badges are looked up by exact username from Supabase: editing your displayed name or page HTML cannot give you staff privileges. Public profile lookups expose only the username, verified role, and optional bio. Users edit their own **180-character bio** in **Account → Profile & bio**; other users can read it on the profile. Keep sensitive personal details out of your bio.

### Chat word filter and moderation

Chat messages are checked **inside Supabase before insertion**. If a message contains prohibited swearing or hateful language, it is not delivered, the composer keeps the draft for editing, and the user sees a clear blocked-and-flagged notice. The private flag log records sender, recipient, type and time for staff review, **not the full rejected message**. Staff can check recent flags from the Cloud staff Reports panel. Normal language and ordinary words containing similar letter sequences should still send. Language filters are imperfect; users can still report inappropriate content that slips through.

### Self-service account deletion

Open **Account → Delete my account permanently**. You must enter your exact username, current password, the word `DELETE`, and confirm the final warning. The server verifies your own authenticated account and password before deleting its Cloud profile, credentials, saved Cloud study data, friendships, chat messages and avatar. A last remaining Owner is protected from self-deletion so the project cannot lose its final administrator. Deleting your account cannot erase browser-local backups on other devices; remove those separately if needed.

### Permanent ban expiry

A permanent ban begins a **30-day waiting period**. The database stores the ban timestamp and a private `pg_cron` task checks every day for eligible non-Owner accounts. After the waiting period, the task permanently deletes the banned account and its associated Cloud data. Removing the ban before expiry cancels the deletion eligibility. Pre-existing permanent bans started their waiting period when the feature was installed to avoid deleting accounts unexpectedly. The banned-account screen shows a planned eligibility date and offers data export before the deadline. Owner accounts are excluded from automated removal.

### Navigation and Mini note names

The sidebar collapse arrow minimizes navigation to a compact icon rail on desktop. On narrow screens the menu opens as a slide-out panel; your desktop preference is preserved. In **Mini → Notes**, type directly into **Note name — type to rename** at the top. The saved-note dropdown beneath it is only for switching between existing notes. Notes autosave when you type.

## Progress, focus and quick actions

StudySpire's compact Study Hub adds a dashboard built around the study content you already have:

- **Progress & Focus:** flashcard counts, finished tasks, completed focus sessions, personal study streaks, daily goals and a seven-day activity chart.
- **Upcoming assignments:** reads assignments from the existing Study Lab agenda.
- **Quick focus timer:** 15-, 25-, or 45-minute sessions; a session counts only when it finishes. It pauses when you pause it and will correctly finish when you return to a backgrounded tab.
- **Study suggestions:** a simple local recommendation based on upcoming assignments or cards to review — no extra AI download.
- **Compact sidebar:** the existing collapse control still works and can also be toggled with **Ctrl/⌘ + B** on desktop.
- **Quick actions:** press **Ctrl/⌘ + K** (or **/** when not typing) to search features such as the progress dashboard, AI settings, account menu, and saved work.
- **Diagnostics:** open **Health** in the top bar to check WebGPU availability, shader support, approximate browser storage usage, cloud connection, and the current AI loading message. Use **Copy results** when reporting an issue.

Daily activity is calculated from **new changes** to the Study Suite (flashcard reviews, completed tasks and completed focus sessions) plus the new Quick Focus timer. Older data still contributes to lifetime counts, but past daily totals are not invented. Progress is saved using account-scoped storage under `studydock-study-progress-v1` and included in the supported cloud study-data sync. Browser-only accounts remain local.

## How it works

```text
Browser (index.html)
  ├── Study tools and browser-local data (localStorage)
  ├── Browser AI (optional WebGPU + downloaded model)
  └── cloud.js (optional cloud bridge)
        ├── cloud-config.js (Supabase URL + public publishable key)
        └── Supabase
              ├── Authentication / anonymous sessions
              ├── Private username credentials and session mappings
              ├── User profiles and role checks
              ├── Per-account study data
              ├── Reports, bans and moderation audit
              └── Owner-approved password recovery
```

**Local study storage:** StudySpire saves supported study sections in the browser's `localStorage`. Signed-in cloud accounts use account-specific local keys to avoid mixing saved work between accounts.

**Cloud synchronization:** `cloud.js` reads supported study data, synchronizes it with `public.ss_study_data`, and restores it for the signed-in profile. Cloud data is scoped by the account's canonical profile ID. Browser storage is not a substitute for a backup.

**Permissions:** Supabase PostgreSQL functions and row-level security (RLS) enforce account and staff privileges on the server. The browser shows different dashboard controls by role, but hiding controls is *not* the security boundary.

## Accounts and cloud synchronization

### Create a new username account

1. Open the StudySpire website and choose **Cloud account**.
2. Select **Username + password**.
3. Enter an available username (3–32 lowercase letters, digits, underscores or hyphens) and a password of at least 10 characters (maximum 72 bytes).
4. Click **Create account**.
5. After registration, StudySpire loads the new account's personal study workspace.

No email or phone number is required for these username accounts. During beta, `admin` is an allowed username; **having that username does not give administrative permissions**. The server assigns every new account the **Student** role until an Owner promotes it.

### Sign in, sign out, and use multiple accounts

Use **Username + password → Sign in** to open an existing account. The account menu offers **⇄ Switch account** and **＋ Add account**; these explicitly sign out of the current account and return to the appropriate screen.

StudySpire remembers up to eight **usernames only** on this browser. Choose a remembered username to fill the sign-in field, then enter its password. **Passwords and active sessions are not stored by this account switcher.** StudySpire does not support being signed into multiple cloud accounts simultaneously in one browser tab.

### Change your own password

While signed into a **username account**, open **Manage account → Change my password**. Enter the current password, a different new password (at least ten characters, 72 bytes maximum), and confirmation. The password change is checked securely on the server; incorrect attempts are rate-limited, and other devices must sign in again after a successful change.

Older **email accounts** continue to use Supabase's normal email/password features. The username-password change panel is intended for username accounts only.

Older email-based users can select **Older email account** and use their existing credentials. Creating a new username account does not automatically merge it with an older email account.

### Move study content between accounts

1. Sign into the source account and **Export all study data**.
2. Keep a copy of the exported JSON backup.
3. Sign out and sign into the destination account.
4. Use **Import old backup** to import the JSON data.
5. Review the imported study sections before deleting any original copy.

Importing study data does **not** transfer roles, passwords, bans, reports, or account identity. Matching study sections in the destination account may be replaced.

## Cloud friends and messaging

The **Messages & friends** page now supports private conversations between signed-in StudySpire Cloud accounts on different devices. It keeps the earlier **local-device demo** only if Cloud is not configured; local-demo contacts and messages are not automatically migrated to Cloud.

### Add a friend and start a conversation

1. Sign in to your Cloud account.
2. Open **Messages & friends** in the sidebar or Study Suite tabs.
3. Enter the person's **exact StudySpire username** (not their email) and select **Search**.
4. Click **Send friend request**.
5. The other person signs in, opens the page, and clicks **Accept** (or **Decline**).
6. Select the accepted friend under **Chat with**, write a message and click **Send message**. You can also press **Ctrl/⌘ + Enter** from the message box.

Messages are saved in Supabase and load on other devices. The page checks for new conversations/messages while open (approximately every ten seconds) and also provides a **Refresh** button. This is polling, not a push-notification system.

### Share flashcards

Choose an accepted friend and click **Share my flashcards**. StudySpire sends a copy of up to **25 flashcards** from your library. The recipient can add the deck from **Flashcards shared with you**. Importing **adds** cards to their own collection instead of erasing existing flashcards.

### Safety and privacy

- Friend requests require **recipient approval**. Decline or cancel requests at any time.
- Use **Remove** to end a friendship or **Block** to prevent future invitations/messages. Unblocking does not restore friendship automatically.
- **Report** a received message if it violates the rules. The report sends the selected message text and your reason to staff for review; unrelated conversations are not exposed in the staff dashboard.
- Messages are limited to **2,000 characters**, with per-account spam limits and bounded history loaded in the UI.
- Conversation content is stored privately on StudySpire's Supabase project. **Messaging is not end-to-end encrypted**, and users should avoid sharing sensitive personal information.
- Deleted friendships and blocking stop further conversation access; the system does **not currently** provide message deletion, editing, read receipts, attachments, or push notifications.
- Server functions require an active, unbanned Cloud account and verify friendship and blocks for each action. The underlying five social tables have RLS enabled and are inaccessible directly to browser API roles.

## Roles and dashboards

StudySpire has four levels, in descending order:

**👑 Owner → 🛡 Admin → ⚑ Moderator → 🎓 Student**

| Capability | Owner | Admin | Moderator | Student |
| --- | :---: | :---: | :---: | :---: |
| Personal study features | Yes | Yes | Yes | Yes |
| Review reports | Yes | Yes | Yes | No |
| Ban/unban Students | Yes | Yes | No | No |
| Ban/unban Moderators | Yes | Yes | No | No |
| View manageable account lists | Yes | Yes | No | No |
| View relevant moderation history | Yes | Yes | No | No |
| Assign or change roles | Yes | No | No | No |
| Promote another account to Owner | Yes | No | No | No |
| Issue or deny password reset codes | Yes | No | No | No |

### Owner dashboard

The **Owner Dashboard** includes account management, role assignment (including multiple Owners), reports, audit history, and password recovery requests. An Owner can promote a registered account to Owner. Owners cannot demote themselves through the role-change control, and the server prevents removing the last Owner.

To grant an account a role:

1. Sign in as an Owner.
2. Open **Owner Dashboard → Accounts & roles**.
3. Select an existing username account.
4. Choose **Student**, **Moderator**, **Admin**, or **Owner**.
5. Confirm the change, especially when granting or removing Owner access.

**Do not assign Owner access based on the account's username alone.** Owner permissions include the ability to manage other Owners.

### Admin dashboard

The **Admin Dashboard** exposes account moderation for Students and Moderators, reports, and relevant action history. Admins cannot assign roles, manage Owners, or approve password recovery.

### Moderator dashboard

The **Moderator Dashboard** focuses on the report queue and review actions. Moderators cannot ban users, assign roles, view the global account list, or issue recovery codes.

### Student experience

Students use the normal study workspace without staff moderation controls.

## Password recovery

**Username accounts use Owner-assisted password recovery, not email reset links.**

### For someone who forgot their password

1. Sign out of any active StudySpire account.
2. On the sign-in screen, choose **Forgot password? Owner-assisted reset**.
3. Enter the username and click **Request reset**.
4. Contact an Owner so they can independently verify that you own the account.
5. After approval, receive a **6-digit one-time recovery code** from the Owner.
6. Return to the recovery form, enter your username, recovery code, and new password.
7. Click **Set new password**, then sign in with the new password.

The request screen intentionally does not reveal whether a username exists.

### For an Owner handling a request

1. Sign into an Owner account and open **Owner Dashboard → Password recovery**.
2. Review the pending request.
3. **Verify the requester's identity through a trusted independent channel.** A username alone is not proof of ownership.
4. Click **Issue one-time code**, or **Deny request** if verification fails.
5. Copy the generated **6-digit code** and privately share it with the verified account holder. It is displayed only once.
6. The account holder—not the Owner—chooses and enters the new password.

**Recovery safeguards:** Codes contain **6 numeric digits** (including possible leading zeroes), are generated with cryptographically secure randomness, stored as hashes, expire after **15 minutes**, and allow at most **five incorrect attempts**. Requests are throttled. Successful recovery invalidates existing username-session mappings and is logged in the moderation audit.

**Limitations:** Identity verification is currently manual; there is no automated email or phone verification. Never request, collect, or share a user's password. The recovery workflow needs full end-to-end testing before production use.

## Browser AI

StudySpire includes an optional browser-based AI assistant using `@mlc-ai/web-llm`. It downloads an AI model into the browser and attempts to run inference on the user's device using supported browser/GPU capabilities.

**To use it:**

1. Open the AI feature in StudySpire.
2. Select or load an available model.
3. Allow time for the initial model download; this may be large.
4. Watch the progress/status messages and wait for the model to initialize.
5. Ask a question once the model is ready.

The loader pins **WebLLM 0.2.85** and uses backup CDN sources. Before loading, it checks the model's WebGPU feature and buffer-size requirements, offers a compatible alternative if needed, and displays the model's **estimated GPU memory requirement** from WebLLM (which is *not* the download size). It also remembers the last model successfully initialized on this browser. The supported built-in options include **SmolLM2 360M**, **Llama 3.2 1B** (default), **SmolLM2 1.7B**, and **Llama 3.2 3B**. Earlier Qwen 2.5 selections were removed because they are not present in this WebLLM version's built-in model list. The loader falls back to a compatible supported model if a saved choice is no longer available.

Temporary library/download errors may retry automatically; GPU device or memory failures are not retried in a loop. If the download stays at 0% for over four minutes, StudySpire stops waiting and asks you to **refresh the page before trying again**, to avoid overlapping GPU downloads. If it reports that WebGPU is unavailable, enabling browser graphics acceleration or using another supported browser/device may be necessary.

The AI is **experimental** and a full real-device model download has not yet been verified.

Browser AI model loading is separate from Supabase username authentication; cloud sign-in is not what downloads the model.

## Installation and deployment

### Requirements

- A modern browser; browser AI additionally needs supported WebGPU/device resources.
- A static web host such as GitHub Pages.
- A Supabase project for cloud accounts, synchronization, and staff tools.
- Supabase Anonymous Sign-Ins enabled for username accounts.

### Run the website

1. Clone or download this repository.
2. Host its root directory using a static web server or GitHub Pages.
3. Open `index.html` through the hosted URL.
4. For cloud features, configure Supabase as described below.

The site is largely static and does not require a Node.js build step for the root HTML/JS. Avoid using `file://` for normal testing because browser module loading and other APIs can behave differently from an HTTP(S) origin.

### Deploy with GitHub Pages

1. Open your repository on GitHub.
2. Go to **Settings → Pages**.
3. Select the appropriate deployment source and publish from the configured branch (commonly `main`) and root folder.
4. Save, then check **Actions** for deployment results.
5. Open the published HTTPS URL and hard-refresh if the previous version remains cached.

Keep `index.html`, `suite.js`, `enhancements.js`, `enhancements.css`, `cloud.js`, and `cloud-config.js` together in the repository root.

## Supabase setup and migrations

> **For a new Supabase project.** The existing StudySpire project has already had the newer migrations applied. **Do not blindly rerun the original schema on an existing database**: older SQL files contain earlier function definitions that can override later security changes.

1. Create a Supabase project.
2. In **Authentication**, enable **Anonymous Sign-Ins** (needed for username/password accounts built on anonymous Supabase sessions).
3. Locate the project's URL and **publishable/anon key** in Supabase settings.
4. Configure `cloud-config.js`:

   ```js
   window.STUDY_SUMMIT_CLOUD = {
     url: 'https://YOUR_PROJECT_REF.supabase.co',
     publishableKey: 'YOUR_PUBLIC_PUBLISHABLE_KEY'
   };
   ```

5. In **Supabase SQL Editor**, run these files **in order** for a *fresh* project:
   1. `supabase.sql` — base profiles, study data, reports, RLS, moderation.
   2. `username-login-migration.sql` — username credentials, anonymous-session mapping, username login.
   3. `role-permissions-recovery-migration.sql` — role-scoped dashboards and Owner-assisted password recovery.
   4. `six-digit-recovery-codes-migration.sql` — updates recovery functions to use 6-digit codes and invalidates any previously issued long codes.
   5. `self-service-password-change-migration.sql` — allows signed-in username users to change their own password after providing the current password.
   6. `cloud-messaging-migration.sql` — private friend requests, accepted friendships, private messages, blocking, reports, and shared flashcard decks.
6. Verify the SQL statements succeeded and that username registration/login work.
7. Create an initial Owner through a **trusted project-administrator-only database operation** after verifying the intended account. Never let public signup or client-side JavaScript grant Owner privileges.
8. Deploy the static website and test role permissions with separate accounts.

**Migration ordering matters:** The later files redefine selected functions from the base schema. Upgrading from the previous 32-character code format invalidates outstanding codes; Owners must reissue them. Applying an old SQL file *after* a newer one can unintentionally undo fixes or weaken authorization checks.

**Key safety rule:** `cloud-config.js` may contain the **public publishable/anon key**, but **never** a Supabase secret, `service_role` key, or database password. Those must not be committed to a public repository or placed in browser JavaScript.

## Repository files

| File | Purpose |
| --- | --- |
| `index.html` | Main StudySpire interface, foundational study tools, and browser AI. |
| `suite.js` | Extracted ~65 KB study suite logic, separately cached by the browser. |
| `enhancements.js` | Study progress, focus timer, quick actions, AI settings cleanup, and health diagnostics. |
| `enhancements.css` | Responsive Study Hub, command search and AI settings styles. |
| `messaging.js` | Live Cloud messaging UI: exact-username friend search, requests, chats, blocking/reporting and shared decks. |
| `messaging.css` | Responsive styling for private Cloud conversations and friends. |
| `cloud.js` | Supabase client bridge, username sign-in, cloud sync, staff dashboards, and recovery UI. |
| `cloud-config.js` | Public Supabase project URL and publishable key configuration. |
| `supabase.sql` | Original/base Supabase schema, reports, profiles, policies, and moderation functions. |
| `username-login-migration.sql` | Username credentials and custom login RPCs. |
| `role-permissions-recovery-migration.sql` | Role restrictions and Owner-reviewed password recovery RPCs, now using 6-digit codes. |
| `six-digit-recovery-codes-migration.sql` | Incremental update to shorter codes for existing installations. |
| `self-service-password-change-migration.sql` | Server-verified password change for signed-in username accounts. |
| `cloud-messaging-migration.sql` | Private social database tables and strictly validated public messaging RPCs. |
| `README.md` | Project overview, user instructions, setup, architecture, and troubleshooting. |
| `tests/browser-ai-smoke.test.cjs` | Browser AI startup and model-selection regression checks. |
| `tests/studysummit-upgrades.test.cjs` | Independent-script, password security, account isolation and progress/health regression checks. |
| `.github/workflows/browser-ai-smoke.yml` | Runs these regression tests on pull requests and main. |

## Security and limitations

- **Beta software:** JavaScript syntax and some backend function checks have been performed, but no comprehensive penetration test or real-world compatibility test is claimed.
- **Server authorization:** Role and ban enforcement belongs in Supabase functions/RLS, not solely in hidden browser buttons.
- **Password storage:** Username passwords are hashed in a private Supabase schema. The browser should never receive password hashes.
- **Custom authentication:** Username accounts use Supabase anonymous sessions and database RPCs, rather than Supabase's standard email/password identity model. Have this design independently reviewed before a large public launch.
- **Messaging:** Social database tables are private; RPCs require canonical authenticated profiles and active accounts. A sender must be an accepted friend, and blocks are checked on the server. Reported messages are visible to authorized moderators for review.
- **Role changes:** Only authenticated active Owners should be able to grant Owner privileges; an account named `admin` is not automatically an Admin.
- **Recovery:** Owners verify requesters manually. Recovery codes are temporary and must be delivered privately.
- **Data:** Browser storage may be cleared, and sync may fail. Export backups of important study data. New focus sessions and daily study progress are tracked by account, not as a public leaderboard.
- **Bans:** A ban restricts cloud account operations; it cannot prevent someone from downloading publicly hosted HTML/JavaScript.
- **Privacy:** Do not store sensitive student records or regulated personal information without appropriate privacy and security review.

## Troubleshooting

| Problem | What to check |
| --- | --- |
| **Create account** fails | Anonymous Sign-Ins enabled; username valid and unused; password length; username migration applied; sign out of any current account. |
| **Wrong password** | Confirm username and password. Repeated failures can trigger a temporary login lockout. Use Owner-assisted recovery if needed. |
| **Account has no Owner/Admin dashboard** | Confirm its server-side role; newly registered accounts start as Students. Sign out and back in after promotion. |
| **Role change denied** | Only an active Owner can assign roles; the last Owner cannot be removed. |
| **Recovery request not visible** | Confirm the request was made while signed out, an Owner is logged in, and the newest recovery migration is installed. |
| **Recovery code rejected** | Check username and all six digits, expiry (15 minutes), five-attempt limit, and whether the code has already been used. |
| **Cloud sync fails** | Open **Health** for last cloud sync status, check the Supabase URL/key and connection, and export a backup before troubleshooting. |
| **Password change fails** | Use a signed-in username account, enter the correct current password, and check the new password constraints. Repeated wrong passwords can cause a temporary lockout. |
| **Progress seems empty** | Daily activity begins tracking new reviews/tasks/focus work after upgrading. Older study data still counts toward lifetime metrics but cannot reconstruct historical daily activity. |
| **Messages don't load** | Verify both people signed into Cloud accounts, reload the page after deployment, check `cloud-messaging-migration.sql`, and use the Refresh button. A request must be accepted first. |
| **Cannot send a friend request** | Check the exact username, whether a request already exists, whether either person blocked the other, and any cooldown or daily request limit. |
| **Cannot send a message** | Both accounts must be active friends and unblocked. Check the 2,000-character limit and temporary rate limits. |
| **Deck import doesn't work** | Check that the recipient's flashcard library has room; imported cards are appended, not overwritten. |
| **AI stuck or download fails** | Use **SmolLM2 360M** as the smallest option; check WebGPU support, hardware acceleration, device memory, network access to Hugging Face, and browser console. For a 0% stall that times out, reload the page before retrying. The console retains the original error. |
| **Website shows old version** | Check GitHub Pages deployment and perform a hard refresh to clear cached assets. |
| **Database RPC/function missing** | Check the migration order and Supabase SQL Editor errors. Do not reapply older migrations over newer ones without reviewing them. |

## Developer regression checks

The codebase includes dependency-free smoke tests for missing DOM elements, corrupted saved history, supported model IDs, account safety, and study progress calculations. Run them with Node.js 22 or newer:

```sh
node --test tests/*.test.cjs
```

The GitHub workflow runs these tests on pull requests and updates to `main`. These tests do **not** replace an actual WebGPU download on a physical GPU.

## Useful documentation

- [GitHub Pages](https://docs.github.com/en/pages)
- [Supabase documentation](https://supabase.com/docs)
- [Supabase Anonymous Sign-Ins](https://supabase.com/docs/guides/auth/auth-anonymous)
- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [WebLLM](https://github.com/mlc-ai/web-llm)

---

**StudySpire is under active development.** If something breaks, record the browser, steps to reproduce, any visible error, and relevant console output—without sharing passwords, recovery codes, or secret keys.


## Optional hosted tutor and fair-share quotas

StudySpire's **optional** hosted AI route is the Supabase Edge Function `studyspire-tutor` (deployed with JWT verification). It only runs after an authorized project operator configures a compatible provider; the website itself requires **no provider keys**. The app attempts hosted tutoring for signed-in Cloud accounts, then offers an explicit **free WebGPU browser-AI download** if hosted inference is unavailable. Once browser AI is installed, it can also be used when hosted AI fails. This preserves tutoring and Mini without individual provider accounts.

### Student quotas versus provider credits

The private Supabase database tracks each StudySpire profile separately. The deployed server quota allows **up to 60 hosted requests per student per UTC day** and an overall maximum of **400 hosted requests per UTC day**. The browser Settings → AI & Mini panel includes a button to check remaining personal and shared site quotas. Every hosted request reserves quota before contacting the provider, so even failed provider calls can count. The counters reset at midnight UTC. These are *application limits*, not provider entitlements: the external free allowance can run out first. A student does not receive new external free credits by signing up, and API keys do not create independent provider allocations.

### Hosted provider activation — for an eligible adult/institutional operator

The dormant endpoint currently supports **Cloudflare Workers AI** using the `@cf/meta/llama-3.1-8b-instruct-fp8` model, with a strict Tutor-First policy and text-only inputs. Before enabling it for a student-facing product, an eligible adult/institution must review Cloudflare's current terms, model license, privacy practices, and school/child-data requirements. The Cloudflare service's own websites and subscriber services aren't directed to under-18 account holders. Do not bypass age restrictions or create provider accounts automatically for students.

An authorized operator can activate the deployed endpoint by setting **Supabase Edge Function secrets** (not Github Actions secrets, not `cloud-config.js`, and not browser local storage):

- `CLOUDFLARE_ACCOUNT_ID`: the Cloudflare account's 32-character ID.
- `CLOUDFLARE_AI_TOKEN`: a narrow Workers AI token for that account.

Never paste an AI provider token in the StudySpire client or GitHub. If these secrets are missing, the endpoint responds with `NOT_CONFIGURED` and the website offers free WebGPU setup instead. Published Cloudflare free allowance is measured in *neurons*, not fixed daily question counts, so actual provider capacity depends on tokens/model costs.

Implementation: `supabase/functions/studyspire-tutor/index.ts` is the deployed server code, and `studyspire-ai-quota-migration.sql` contains the quota schema and RPCs. Quotas require a canonical active StudySpire profile, not merely a username supplied by the browser.


## Zero-neuron public study guides via Cloudflare Workers (optional)

StudySpire has a **reviewed catalog of 20 common learning concepts**: photosynthesis, mitosis, fractions, linear equations, essay thesis statements, and more. Questions matching a **standalone general concept** are served from that catalog *before* using hosted AI. The response gives explanations, a distinct worked-thinking example, and a follow-up question rather than a personalized assignment answer.

This does **not** use Workers AI or consume any AI neurons. Cloudflare Workers' free allowance of 100,000 requests per day can serve these public guides once the Worker is deployed. The **10,000-neurons-per-day** Workers AI allowance is separate. The existing 60-questions-per-student and 400-total hosted-AI quota still apply **only to generated hosted AI responses**.

### Deploying the optional public Worker

The Worker source is `cloudflare/studyspire-guides/index.mjs`, the shared reviewed catalog is `studyspire-guide-catalog.mjs`, and `wrangler.toml` contains the deployment settings. An **eligible Cloudflare account administrator** can deploy this from the repository root using the supported Wrangler CLI (`npx wrangler deploy`) and the account's approved deployment workflow. This Worker needs **no AI token, account identifiers, KV, D1, database, or other paid bindings**.

Once deployed, the administrator can edit **only the public URL** in `cloud-config.js`:

```js
guideWorkerUrl: 'https://studyspire-guides.YOUR-WORKERS-SUBDOMAIN.workers.dev'
```

Do not add secret API keys to `cloud-config.js`. The `/health`, `/v1/topics`, and `/v1/guide?topic=photosynthesis` paths provide public, read-only content. No student prompt, message history, credential, or account identifier is sent to this Worker: the frontend extracts an exact recognized **public topic slug** first. If the Worker is not deployed or unreachable, the same reviewed guide is served from the browser at **zero API cost**. Questions outside the narrow guide catalog go to the normal tutor, retaining the explicit browser-AI choice when hosted AI cannot answer.

Authenticated student quotas are **deliberately kept in Supabase**, not in this public Worker, to prevent exposing student account data or making a public quota-bypass endpoint. Deployment is not automatic and requires the Cloudflare account operator; the current repository includes the full source code and no third-party account credentials.

## Zero-API-token Cloudflare Workers AI binding

**Prepared, but not yet live:** The Supabase tutor supports direct Cloudflare Workers AI binding requests without requiring `CLOUDFLARE_AI_TOKEN` in Supabase. The Cloudflare Worker **must be redeployed with an AI binding named `AI`** by an eligible account operator. GitHub pushes do not publish an unrelated Cloudflare Worker automatically.

The repo's `wrangler.toml` targets the already-public `studyspire` Worker at `https://studyspire.zacharykeef735.workers.dev`, with an `[ai]` binding. Deploy it from the repo root via an authorized operator's Wrangler workflow (`npx wrangler deploy`), or configure the AI binding named `AI` in the Cloudflare dashboard and publish the matching updated code. No Cloudflare REST API token needs to be copied to Supabase for this binding route.

Once deployed, open `https://studyspire.zacharykeef735.workers.dev/health`. It must report `"version":2` and `"aiBound":true`. The `zk5142`-only connection test should report `AI_BINDING_READY`; then test a personalized question to confirm inference. If the Worker is still on version 1 or `aiBound` is false, **real AI generation is not yet available** via the binding.

The Worker validates the student's Supabase Auth session and atomically reserves a quota against the server-verified profile via `ss_ai_claim_mine` (60 questions per student, 400 site-wide per UTC day). Other users cannot claim on behalf of someone else's username, and the provider's actual neuron allowance may run out sooner. Public reviewed guides still use zero AI neurons and never receive student questions; generated tutor prompts are sent to Cloudflare Workers AI. An eligible operator must review applicable service terms and student-data requirements. The legacy Cloudflare REST API route is retained only as an alternative.

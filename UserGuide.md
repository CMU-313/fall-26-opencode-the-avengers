# User Guide

## Session recap

When you reopen a session, a recap appears above the prompt telling you where
you left off:

```
│ Welcome back! Here's where you left off
│
│ Completed
│   • Added the login page and wired it to the auth service
│   • Set up the users table
│
│ Unfinished from your plan
│   • Write the handler tests
│
│ Next steps
│   • Write the handler tests
│   • Hook the handler up to the router
│
│ click to dismiss
```

It has three parts:

- **Completed** — what got done, summarized by a small model from the session
  transcript.
- **Unfinished from your plan** — plan items that are still open. These are
  computed in code from your actual plan, not asked of the model, so they are
  always accurate.
- **Next steps** — if the session had a plan, these are built from the
  unfinished items. If it did not, the model suggests two to four based on the
  work so far, and the heading reads "Suggested next steps".

### Using it

Nothing to turn on. Open a session that has some history and the recap renders
automatically.

- It disappears as soon as you send a message, so it never sits in the way.
- Click it to dismiss it early.
- A session with no history shows nothing at all.

### Where the plan comes from

The recap looks for a plan in two places, in order:

1. **The session's todo list**, if it has one. Items marked `completed` or
   `cancelled` count as done; `pending` and `in_progress` are carried over.
2. **Markdown checklists in the conversation**, if there is no todo list:

   ```markdown
   - [x] set up the database
   - [ ] add the login page
   ```

   Both `-` and `*` bullets work, indentation is fine, and `[x]` and `[X]` both
   mean done. If the same item appears more than once, the most recent checkbox
   wins — plans get re-posted as work lands.

If neither exists, the recap has no "Unfinished" section and the model suggests
next steps on its own.

### Caching

A recap is stored once generated and reused until the session changes. Opening
the same session twice does not pay for the model twice. The moment you send
another message, the next open regenerates it.

### API

```
GET /session/{sessionID}/recap              # generate if stale, else cached
GET /session/{sessionID}/recap?cached=true  # only return a stored recap
```

Both return `{ "recap": { ... } }`, with the key **absent** when `cached=true`
and nothing has been generated yet. The `cached=true` form never calls a model,
which is what makes it cheap enough for a session list.

### Limitations

- The summary is model-generated and can be wrong or incomplete. The
  "Unfinished from your plan" list is not — that one is computed from your plan
  in code.
- If the model is unavailable or returns something unparseable, the recap
  degrades to showing only your unfinished plan items rather than failing.
  Resuming a session never depends on the model answering.
- Only text is read. Tool calls and their output are not part of the
  transcript the model sees.
- Very long sessions are truncated to the most recent ~12,000 characters,
  since the end of a session is what "where did I leave off" depends on.

### Try it end to end

1. Start a session and ask for something small, for example
   `create hello.txt with the word hi`.
2. In the same session, post a plan:

   ```
   - [x] create hello.txt
   - [ ] add a second line
   ```

3. Leave the session (`/sessions`, pick another, or restart).
4. Reopen it. The recap appears: `create hello.txt` summarized under
   **Completed**, and `add a second line` under **Unfinished from your plan**.
5. Send any message. The recap disappears.

### How this feature is tested

Run from `packages/opencode`:

```bash
bun test test/session/recap.test.ts test/session/recap-service.test.ts
bun run script/httpapi-exercise.ts --mode effect
```

| File                                    | Covers                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test/session/recap.test.ts`            | The pure logic, no layers: checklist parsing (bullet styles, indentation, capital `X`, later mentions winning, case-insensitive matching, lines that only look like checklists), transcript building including the truncation that keeps the end, both branches of the prompt builder, model-output parsing across fenced blocks and surrounding prose, and the display formatter.                 |
| `test/session/recap-service.test.ts`    | The real service with only the LLM replaced: `peek` against an empty store and against a stored value that no longer matches the schema, cache reuse and regeneration keyed on the session timestamp, todos preferred over markdown checklists, carry-over of unfinished items, next steps falling back to those items when the model offers none, and empty sessions skipping the model entirely. |
| `test/server/httpapi-exercise/index.ts` | The HTTP route end to end against a running server, via the `session.recap` scenario.                                                                                                                                                                                                                                                                                                              |

The service tests use no mocks. Session storage, todos, the agent registry and
the provider all run as they do in production; only the LLM layer is swapped
for one that returns canned text and records the prompts it was given, which
is how "never calls the model" is proved rather than assumed.

<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Mock data lives in src/data and all data access goes through src/lib/api.ts, so a real detection API can replace the mocks in one place.
- Shared detection/demo state lives in src/lib/store.tsx (React context) so the Review Queue and Digital Twin stay in sync.
- Keep mobile navigation in AppShell and mobile-only data presentations beside their desktop views; this preserves existing desktop workflows while giving narrow screens usable controls.

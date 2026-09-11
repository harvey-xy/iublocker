# Manual QA checklist (before each release)

Run with a clean profile, default lists, `optimal` mode unless noted.

1. Install unpacked; popup opens; badge appears after loading a news site.
2. https://www.youtube.com — no pre‑roll / mid‑roll ads on 3 videos; player controls intact.
3. Three top news sites in your locale — no banners, no blank gaps larger than 50 px.
4. A site with an anti‑adblock wall (see uBO issues list for a current example) — content visible.
5. A site with a cookie banner with EasyList Cookie enabled — banner gone, page scrollable.
6. Banking / government site in `basic` mode — login and forms work.
7. Switch a site to `off` — ads show; switch back — ads gone without reload issues.
8. Add user filter `||example.com^$image` — images on example.com blocked immediately.
9. Element picker on a blog sidebar — filter created, element hidden after reload.
10. Trigger list update from the dashboard — version string changes, no console errors.
11. `chrome://extensions` → errors panel empty after 30 minutes of browsing.
12. Memory: worker heap < 60 MB after the above (DevTools → Memory).

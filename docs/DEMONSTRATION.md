# The Demonstration

The Start screen offers the existing 33-year campaign, from 1042 to 1075,
alongside Short and Long Lines. Its saves, continuation and removal controls
are separate from the full-campaign autosave. A finished Demonstration enters
the Library labelled as a Demonstration; its saved simulation cannot become a
full campaign and it supplies no founding share code.

## Complete browser route

`tests/e2e/demo-complete.spec.ts` starts from the normal front door and signs a
new house through the staged signing. It makes an ordinary Match choice,
reloads with the founder's Record still unanswered, resumes through the saved
Demonstration control, embellishes that page, sees the frame return to the
named founder, closes the opening Age and reaches the 1075 verdict. It checks
the durable Record, interlude and Library entry, with the pre-existing full
campaign's autosave byte-for-byte unchanged.

The route runs in Original at desktop width and Plain English at phone width.
It also reads a real opening Chapter at 480 × 320, scrolling from the first
line to its continuation control. The card stays inside the available reading
area. The earlier fixture-based demo browser specs remain separate checks of
Record consequences, exports, identity, storage refusal and deletion.

Run the complete route with:

```sh
npm run test:e2e -- --project=chromium tests/e2e/demo-complete.spec.ts
```

## Evidence boundary

This browser route proves an integrated path through the shipped client. It
does not measure newcomer comprehension, enjoyment, real-time play duration,
or conversion. Automated Chromium viewport and storage checks also do not
establish acceptance on physical native devices. Separate Steam demo app and
owner-account publication work remains distinct from the playable front door.

Refs [#1979](https://github.com/EldritchDynasty/EldritchDynasty/issues/1979).

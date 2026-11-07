# Long Line purpose recognition audit — #1983

Reviewed the shipped purpose reading in packages/core/src/ending.ts on 8 November 2026 (NZ). This is a source/mechanism audit, not a completed reader study or a disposition of the parent issue.

## Existing recognition

| Tracked ambition | Grounded account at collection | Limit |
| --- | --- | --- |
| Deepen the blood | An attributed rite of a blood relative joined to its surviving, named Chronicle page | The house's written claim is not a moral verdict |
| Secure the branches | A dated founding charter and a viable cadet hall with a named surviving blood relative; optionally another documented lost hall | This does not establish who saved or destroyed a hall |
| Restore the Ledger | One unique unaltered illuminated page matching a genuinely recovered clause in either prose form | Recovering words is not paying the debt |
| Raise an ascendant | A uniquely identified automatic ledger-wait page, tied to a dated person and surviving account | Waiting is not proof of eventual apotheosis |

The existing code and tests distinguish an actual pursued purpose from mere ambition selection. They reject greyed/altered or duplicate testimony, impossible historical dates and people not yet born; they keep post-collection changes out of the collection-time view. Names earned after collection are not backdated. The client reads the derived result; no separate award or outcome is stored.

## Integrity defect and bounded correction — #3263

A recovered name or page text could be blank or a non-string value. This created confident ending copy with an unreadable founder, survivor, hall, rite victim or quotation. In particular, ascendant-wait checked only for non-null text; blood-spent could also quote a blank record. A lost-hall label is optional and should not invalidate otherwise credible testimony about a living hall.

The correction checks whether the required public strings contain a non-whitespace character, without rewriting their content. A missing required witness suppresses only that purpose reading. An unreadable optional lost-hall label removes only the optional contrast. Valid names and exact authored text remain unchanged, for both Original and Plain English. No changes to the ending choice, save format, core campaign model, Afterimage contract or Chronicle commitment are intended.

Focused ending.test.ts regressions cover unreadable names and testimony, both prose modes, valid restoration, unchanged ending choice and read-only digests. This connector-only session did not run local npm or Vitest: CI on the exact proposed commit and the integration merge-group must provide the execution result.

## Parent acceptance still outstanding

Parent #1983 still needs a dated participant study on the complete last night, contrasting a pursued family purpose with an unpursued or failed one. Record the build, histories, observation protocol, participants and incomplete sessions; assess whether readers distinguish purpose, specific family consequence and cost from Ascension. An automated evidence audit is not proof of reader comprehension, so leave #1983 open.

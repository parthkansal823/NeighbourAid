# Proposed next features

These are **ideas, not completed features**. The current app already has alert
triage, a map, paid-help offers, contact release after acceptance, safety
check-ins, quiet hours, drills, resource matching, estimated dispatch times,
offline queuing and optional push/webhooks. Those are not new proposals here.

Paid-help preferred visit windows and a private work timeline are now
implemented too. The timeline records posted, accepted, started, done and
cancelled timestamps only when those actions actually happened. It is not an
emergency responder arrival/handoff timeline.

## Recommended next

1. **Private case chat.** Reporter and accepted responder/worker can message
   inside their case. Limit access to participants, add reporting/blocking,
   and decide retention before storing messages. Not a claim of end-to-end encryption.
2. **Responder handoff.** An accepted volunteer can request a replacement;
   the requester sees who is responsible rather than the case silently reopening.
3. **Worker reviews after completion.** One review per completed job, with
   moderation and an appeal path. No made-up ratings or self-issued trust badges.
4. **Agreed rescheduling.** Let a requester propose a new visit window and
   the accepted worker confirm it. The current window is only a preference,
   not a confirmed appointment or worker-availability calendar.
5. **Emergency case handover history.** Add actual arrival and responder
   handoff actions to emergency cases, with participant-only details. The paid
   job timeline does not yet provide these emergency-case events.

## More useful additions

6. **Verified skill badges.** A moderator reviews training/skill evidence;
   clearly distinguish self-declared skills from checked ones. Avoid collecting
   identity documents unless there is a defined need and protection plan.
7. **Team response.** Assign different roles to multiple volunteers on one
   incident, with one coordinator and explicit acceptance.
8. **Saved neighbourhoods.** Opt-in alerts for home, campus or parents' area,
   without continuous location sharing. Keep critical-alert behavior clear.
9. **Trusted-circle updates.** Account-linked contacts receive opt-in case
   status updates and time-limited location access, not just a saved phone list.
10. **Offline emergency kit.** Saved essentials and source-reviewed evacuation
    checklists, with source/update dates. Do not present offline material as
    live hospital capacity or replace emergency services.
11. **Route-aware ETA.** Use an actual route/travel mode rather than only
    distance/speed estimates; label it approximate and check provider costs,
    permissions and traffic coverage. [Routes API capability reference](https://developers.google.com/maps/documentation/routes/compute_route_directions).
12. **Accessibility mode.** Large-text controls, screen-reader-tested SOS and
    clearer confirmations. Extend existing voice/dictation rather than rename
    it as a new feature.
13. **Privacy centre.** Account-data export, deletion requests and controls
    over contact/location visibility. Define what happens to active shared cases.
14. **Moderation dashboard.** Human review of flagged alerts/jobs, transparent
    decisions and an audit history that avoids logging tokens or private reports.
    [Safe logging reference](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html).
15. **Development review assistant.** Produce test-failure, security and
    feature-suggestion reports during CI. Human approval remains necessary;
    no automatic commits, deployments, credential changes or user messaging.

Suggested next priorities are 1, 2 and 3. Hospital/ambulance
live availability, paid messaging gateways and identity-verification providers
need real integrations and consent—not fictional data or automatic emergency calls.

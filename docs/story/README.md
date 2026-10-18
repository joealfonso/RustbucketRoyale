# The story so far

One screenshot (or two) for every playtest gate that passed, in order. Each was taken from the version that passed, run again from its commit, so nothing here is mocked up. Everything is still grey boxes: the look comes at the visual milestones.

When a gate passes, add its shot here: run the passed build, take a screenshot that shows what the gate added, save it as the next number, and add a section below.

---

## 0. M1 in Unity: one mech on a test range
*Passed 17 October, 12:20. Commit `34ef8a6`, branch `unity-prototype`.*

![The Unity prototype: a grey mech with orange arms on a flat test range](00-unity-m1-prototype.png)

The first version was Unity 6. One mech walks, runs, jets and shoots on a flat strip with a tower, a ramp and red targets. It felt fine, the camera clipped into walls, and the per-shot screen shake made it bounce, so that went. Then the game moved to the web, because it has to be reachable by a link and able to scale. This shot was rendered from the archived Unity project.

## 1. M1 on the web: the same mech in a browser tab
*Passed 13:12. Commit `7ea71af`.*

![The web version of M1: the mech from behind on the test range](01-m1-web-one-mech.jpg)

Rebuilt in TypeScript and Three.js. The movement code is shared so a server can run the same thing later. During the playtest the camera went higher above the mech and got a proper crosshair. The fuel and stamina bars sit bottom left.

## 2. M2: two players, one server
*Passed 13:18. Commit `1ac58af`.*

![Two mechs on the range: yours with orange arms, the other player's with blue](02-m2-two-players-online.jpg)

A Node server runs the room and has the final say. Each browser predicts its own mech and corrects quietly when the server disagrees. The blue-armed mech is a second browser tab. Bullets passed straight through people at this point: hits were the next gate.

## 3. M3: hits, damage zones and grenades
*Passed 13:48. Commit `38cbb13`.*

![Your mech with both arms shot off and the arms bar empty, while another mech fires](03-m3-hit-zones-arms-shot-off.jpg)

Shots hit legs, arms or torso, checked on the server against where the target was when you saw it. Damage shows on the mech itself: here both arms are gone and the A bar is empty. Grenades arc and bounce. Testing it led to tap-Shift to dash.

## 4. Dash, after three tries
*Passed 13:58. Commit `003df88`.*

![The F1 tuning panel open, showing speed, dash, jets and stamina sliders](04-dash-and-the-tuning-panel.jpg)

Tap to dash had a delay, press to dash made every run start with a dash, and double-press Shift (or a direction key) stuck. The F1 panel tunes it all live. Later, double-tap W became sprint and Shift a dash in any direction.

## 5. M4: maps from a seed
*Passed 14:20. Commit `dfbd457`.*

![A generated map at ground level: walls, containers and the edge wall](05a-m4-generated-map.jpg)

![The same 1000 m map from above: a grid of 50 m chunks](05b-m4-map-from-above.jpg)

Every match gets a map built from one number, the same on the server and every browser. It's made from eleven hand-made chunk types on a grid, checked so every spawn is clear and reachable. Three sizes: 300, 1000 and 2000 m. A large map builds in about 160 ms. Controls changed in the playtest: double-tap W sprints, Shift dashes.

## 6. Gate 5a: rooms, matches and the ring
*Passed 15:09. Commit `d71bd21`.*

![Room bar, a countdown at zero, containers ahead](06a-5a-rooms-and-countdown.jpg)

![Mid match: Alive 5 of 6, the zone timer, a kill feed and a bot on the radar](06b-5a-a-match-with-bots.jpg)

Rooms by invite link, a host Start, a countdown, then an 8-minute match with a shrinking ring. Knocked-out players spectate, and the next match starts by itself on a new map. Simple bots and the radar were pulled in during the playtest, so there was something to fight. Delay was also cut: the body faces where you look instantly.

## 7. Gate 5b: smarter bots, a real network budget
*Passed 15:22. Commit `d365216`.*

![In the lobby, bots shooting at you: "Destroyed. Back in 2..."](07a-5b-bots-come-for-you-in-the-lobby.jpg)

![A medium match with Alive 22 of 24, the ring wall curving across the sky](07b-5b-twenty-four-in-a-medium-match.jpg)

Rooms fill themselves with bots: easy, normal and hard. Bots plan routes round walls, and far-away ones run in a cheap mode. Messages went binary and nearby-only, cutting bandwidth from up to 1279 kbps to under 64. Damage works in the lobby too, with a quick respawn, which is how the first shot happened.

## 8. Gate 5c: the radar listens
*Passed 15:58. Commit `f66fe62`.*

![Under fire in the 200 m Arena: red damage glow, orange gunfire rings on the radar](08-5c-arena-radar-hears-gunfire.jpg)

A full match per size now plays itself in seconds as a soak test, with fake browsers checking prediction, bandwidth and timing. It caught a real bandwidth problem. The radar stopped showing everyone: mechs further than 40 m only show when they make a sound, so walking is sneaking. The 200 m Arena arrived for quick tests.

## 9. Gate 6a: things to break
*Passed 16:13. Commit `0f85a09`.*

![Crates and junk around the arena, a barrel going up in an orange fireball on the right](09-6a-props-and-a-barrel-going-up.jpg)

Every map has crates, junk piles and red barrels placed by the seed. Shoot them and they're gone, cover and all. Barrels blow up and set off their neighbours. The playtest added sound everywhere (built in code until real recordings arrive) and faster, punchier explosions.

## 10. Gate 6b: loot and a loadout
*Passed 16:30. Commit `77acb00`.*

![Spectating Bot 1 after being knocked out in the Arena: two weapon slots and a grenade count bottom left](10-6b-loadout-and-spectating.jpg)

Broken crates and junk now drop glowing loot: grenades and armor plates you walk over, and two new guns you take with E. Two weapon slots on 1 and 2 or the wheel: the start Autocannon, a close-range Scattergun and a slow, hard-hitting Spike Driver. Plates bolt onto the mech and soak hits first. Grenades are counted now, one to start.

## 11. Gate 6c: picking over the wrecks
*Passed 16:39. Commit `3847272`.*

![Knocked out first and already looted: both slots empty, no grenades, Bot 5 standing over another wreck](11-6c-looted-by-a-bot.jpg)

A knocked-out mech leaves a wreck. Hold E beside it for two seconds and everything it carried spills on the ground round it: guns, grenades, plates. It rattles and shows up on everyone's radar, and letting go starts it over. Bots with nobody to fight now go for loot and wrecks too, which is how this shot happened. Maps also check there is loot near every spawn. That finishes M6.

## 12. Gate 7a: broken parts you can see and feel
*Passed 16:52. Commit `923abf9`.*

![Watching Bot 1 with black smoke pouring off it, the torso bar on the left red](12-7a-smoke-from-a-broken-mech.jpg)

Hit zones now have three states. A damaged part sparks and smokes a little, a broken one pours black smoke, and the HUD bars go yellow then red. Losing your legs drops the mech onto stubs and it drags itself along slowly, though the jets still lift it. Losing your arms means shots fly everywhere and no grenades. Bandwidth had crept over budget with all the loot, so pickups are now only sent when they change.

## 13. Gate 7b: stop and patch it up
*Passed 16:58. Commit `1c08566`.*

![Two battered mechs face off with light smoke trailing, a wreck smoking black on the right](13-7b-battered-mechs-and-a-smoking-wreck.jpg)

Hold F, standing still, and in six seconds your worst part is back in running order. Not new: legs walk again, arms aim again, but only to 40%. Move, shoot or get hit and it starts over, and the clanking shows up on everyone's radar, so stopping to repair is a gamble. Bots with a broken part patch themselves up when nobody is around. (The shot doesn't catch anyone mid-repair: welding sparks come off the part being fixed.) That finishes M7.

## 14. Gate 8a: upgrades
*Passed 20:24. Commit `bd4c981`.*

![End of an Arena match: "Bot 1 wins", wrecks smoking and sparks flying off the winner](14-8a-bot-1-wins.jpg)

Crates and wrecks now and then give up an upgrade: a big tumbling coloured cube you fit with E. Four of them, each one big change: Big Tanks for longer jets, Quick Hands to repair and loot twice as fast, Big Ears to hear further and stretch the radar, Overclock to fire faster. Two sockets, so a third means giving one up. Each bolts a part onto the mech, so you can see what someone is carrying. (The shot is the end of a match, where it's hard to spot the parts at this size.)

## 15. Gate 8b: tuning live, for the whole room
*Passed 20:31. Commit `91a8e84`.*

![The F1 panel: "Tuning: on", the Speed sliders, and every data file with a Copy button](15-8b-live-tuning-panel.jpg)

The tuning panel used to change numbers only in your own browser, which online did nothing to the server and made your mech fight it. Now a change goes to the server, gets checked like loading the file, and lands for everyone in the room at once. Every gameplay file is there, and Copy puts a file's numbers on the clipboard, so a good value goes straight into `data/`. It only works on a server started for testing.

## 16. Gate 8c: measured, not guessed
*Passed 21:12. Commit `2cc1cfe`.*

![The 2000 m map at 60 fps, with the panel showing 0.7 ms of work a frame and 23 draw calls](16-8c-large-map-performance.jpg)

Before going further, the game got measured. In a browser it needs well under a millisecond a frame on the biggest map, and the whole game is a 172 KB download. Match data from dozens of simulated games moved medium rooms from 24 to 28 mechs, so players spend less time alone. A load test with real connections found one server process holds about 40 medium rooms. That finishes M8, the last of the code milestones: everything in the design now exists in grey boxes.

## 17. Gate V1a: the first look
*Passed 21:45. Commit `3e82aa1`.*

![Three grey-box mechs in the toon look: flat bands of light, dark outlines, rust containers on moss, a yellow barrel](17-v1a-first-toon-look.jpg)

The first step from grey boxes toward the real look, on a test page of its own. One toon material for everything: light falls in three flat bands, a warm rim picks out edges, and every box has an outline in a darker shade of its own colour. The colours come from the palette in DESIGN.md (rust, moss, scrap steel), with blue for you, bone white for everyone else, and hazard yellow for barrels. The HUD and decal fonts were chosen too: IBM Plex Mono and Big Shoulders Stencil.

## 18. Gate V1b: the look, everywhere
*Passed 08:46. Commit `7e7932b`.*

![The large map in the toon look: your blue-armed mech, rust and steel walls with outlines, the tuning panel showing 60 fps](18-v1b-the-look-in-game.jpg)

The style test became the game: every wall, crate, mech and pickup in the toon look, your mech in blue and everyone else in bone, the zone ring in magenta. Outlines doubled what the graphics card draws, and it still holds 60 fps. The playtest found that shots aimed at an arm never landed: the crosshair aimed at the wall behind the mech, so shots crossed it a metre off. Now it aims at the mech itself, and every hit pops tick marks and says what it struck. A checker in the test run now holds any real 3D model to the budgets and naming rules, ready for the first one.

## 19. Gate V2a: a mech made of parts
*Passed 08:57. Commit `9bb64e7`.*

![Spectating a stand-in kit mech: rust jets on its back, a sensor on top](19-v2a-kit-mechs-in-a-match.jpg)

Before any real mech is modelled, the game learned to build one from a kit of parts: torso, jets, sensor, legs, arms. Each part comes as an intact, a dented and a broken piece, each in three levels of detail for near and far, with marked points for sparks, smoke and the gun. Damage now swaps the real pieces, so a blown-off leg is the art's own stub. A script made a stand-in kit out of boxes to prove it all, so the first real mech can drop straight in.

---

*Next: the first real mech, starting with three paper thumbnails.*

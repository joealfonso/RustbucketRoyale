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

---

*Next: gate 6c, looting wrecks.*

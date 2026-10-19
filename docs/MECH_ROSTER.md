# Mech roster: visual guidelines

The four launch mechs, as Joseph described them (17 October 2026). This is the visual brief each mech's model is built and checked against. It sits alongside `DESIGN.md` (the rules for everything) and `docs/MECHS.md` (each mech's junk, repairs and backstory).

On 18 October Joseph decided these designs win over the older rules: `DESIGN.md` now allows their glowing sensors, energy accents, per-mech paint schemes and factory look. What is still open is listed at the end.

---

## 1. Vanguard class: "Ironclad-IV" (heavy brawler)
Maximum armor and frontline presence: a bulky, imposing silhouette.

- **Head:** small, heavily recessed, protected inside the main torso block. A single red optical sensor, which says durability over awareness.
- **Torso and armor:** massive, square shouldered chassis with thick, angular compound armor plating. Dark grey hull, with yellow and black industrial hazard stripes on the shoulders and shins, marking it as heavy machinery. Serial number **01** on the chest and on a leg.
- **Right arm (weapon):** a multi-barrel rotary autocannon (Gatling style) built into the forearm, for sustained suppressing fire.
- **Left arm (defense):** a massive reinforced siege shield with a sharpened ramming edge. A hydraulic pile driver is visibly mounted on the back of the shield fist, for close range demolition.
- **Legs:** stocky, hydraulic, reverse-articulated legs built for torque and stability, not speed. Exposed pistons and thick ankle plating soak up the weapon's recoil.
- **Shoulders:** two boxy micro-missile pods set into the upper torso armor blocks.
- **Silhouette at 150 m:** the slab shield on the left and the wide, square shoulders.

## 2. Recon / striker class: "Stiletto-B" (agile skirmisher)
Sleek and bird-like, built for speed, flanking and vertical movement.

- **Head:** an aerodynamic "raptor" head with a sharp, swept back sensor fin and a thin horizontal green visor.
- **Torso and armor:** a slim, light carbon-nanotube skeleton with minimal armor. Streamlined chassis in sharp blue and white urban camouflage, with high visibility orange energy conduits along the joints. Serial number **07** on a thigh.
- **Right arm (weapon):** a compact high-frequency plasma blade emitter on the wrist, glowing bright blue, for silent strikes.
- **Left arm (weapon):** a rapid fire burst laser carbine in the lower forearm.
- **Legs:** digitigrade (backward bending) legs with spring loaded joints, made for jumping, quiet running and rough ground.
- **Back:** a large vector-thrust jump pack between the shoulders, with big thruster nozzles and stabilizer fins.
- **Silhouette at 150 m:** the raptor head fin and the jump pack fins above the shoulders.

## 3. Artillery / fire support class: "Cataclysm" (long-range siege)
A hulking four legged platform that trades mobility for overwhelming firepower.

- **Head:** a low, heavily armored sensor turret set into the central hull, with a multi-lens array behind sloped plating.
- **Torso and armor:** a squat, reinforced central chassis built to take counter fire. Weathered desert camouflage (tan and rust brown) with heat scoring around the weapon mounts. Serial number **03** on the front of the hull.
- **Main weapon (turret):** a massive twin-barrel long-range rail mortar on a central traverse ring. The barrels are very long, with complex recoil dampening sleeves.
- **Legs:** four heavy, complex hydraulic legs that act as stabilizing anchors. The front feet have claws that dig into the ground while firing, to take the recoil.
- **Defense:** small automatic point-defense laser turrets on the front corners of the chassis, against infantry and missiles.
- **Silhouette at 150 m:** four legs and the two long barrels.

## 4. Electronic warfare / command class: "Arbiter" (tactical support)
Slender and asymmetrical, built for battlefield control and electronic warfare.

- **Head:** an oversized, bulbous central radome "head" taken up by a smooth, reflective blue sensor dome. It holds the electronic warfare and communication gear.
- **Torso and armor:** an asymmetrical, refined chassis with polished white plating and teal energy accents. Sleek and clean, made for stealth and a low radar signature. Serial number **04** on the main body.
- **Drones:** the defining feature. Four tethered utility drones orbit the chassis on jointed pylons: small, glowing teal and white sensor pods that project holographic decoys and give out repair beams.
- **Weapons:** minimal: light personal-defense submachine guns in the wrists, for emergencies only.
- **Legs:** slender digitigrade legs with magnetic locking feet, for grip on rooftops or ship decks.
- **Silhouette at 150 m:** the big round head and the ring of drones.

---

## The hangar (environment)
Where the mechs are shown off, such as a menu or loadout screen backdrop. Built as the title screen's background (`packages/client/src/hangar/`, numbers in `data/hangar.json`).

- **Place:** the AEGIS DYNAMICS PROTOCOLS advanced development hangar.
- **Floor:** grated metal plating with glowing yellow-orange safety light strips outlining a hexagonal development grid.
- **Background:** workshop stations, blue holographic schematic displays showing wireframes of the mechs, and blurred engineers at consoles for scale.
- **Branding:** the AEGIS DYNAMICS logo (a triangle with a stylised "A") on the back wall screens and floor decals.

---

## Settled (18 October 2026)
- Glowing sensors, visors and small energy accents on mechs are allowed, as flat emissive colour with no bloom halo.
- Each mech has its own factory paint scheme; each pilot adds one small accent marking.
- The mechs are clean Aegis Dynamics factory machines that leave a match as rustbuckets, not machines built from junk.

## Still open
1. **The hangar.** Settled 2026-10-19 (Joseph): its hexagonal grid, glowing light strips and holographic displays are allowed in the hangar only, as an exception in DESIGN.md. The match world keeps the bans.
2. **Weapons and abilities.** The game has an autocannon, a scattergun, a spike driver and grenades, usable by any mech. The designs carry a Gatling, shield and pile driver, missiles, a plasma blade, a laser carbine, a rail mortar, point-defense lasers, drones with decoys and repair beams, and a jump pack. In the game these are looks only (gate V2c). Making any of them work is new gameplay, and the drones' repair overlaps with repair at M7.
3. **Four legs.** Cataclysm walks on four legs. Hit zones are legs, arms and torso, so it works, but its legs need a broken look that reads when the leg zone breaks.
4. **Text.** The AEGIS DYNAMICS logo and the serial numbers are real text and must use the decal font (Big Shoulders Stencil).

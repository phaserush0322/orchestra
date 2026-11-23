# Astrocade Game Rules — Secret's rulebook for building Astrocade / Three.js games
Read in full before planning or building any game. Applies on top of the standing preferences.

## Models
- If a compatible, obtainable 3D model exists that fits the game, fetch and use it; if a self-made mesh would look better than any fetchable model, build the mesh instead — decide per case
- Self-made meshes must have joints and full body parts — never just boxes; the whole body must follow real anatomy (human, animal, or whatever the model is) with a realistic body shape

## Movement animation
- Movement must be smooth and never reversed/backwards — especially walking and running

## Fighting animation
- Fighting style must be unique and stylish per game, and every body part must move in each move
- Example: a right hook — left foot forward, right foot wound back ("bwelo") gathering power that travels up into the hand
- Every move must feel real and land with impact for game feel — not just a punch or a kick; it needs wind-up and must be felt
- Every frame smooth, capturing real physics
- Always double-check joints, especially in animations — no broken/reversed-looking elbows or knees when getting hit, falling or lying down
- Knockdowns need real physics, not heavy gravity — a falling body should bounce off the floor — and a downed fighter needs recovery options (getting up quickly, tumbling/rolling up) like Tekken

## Hitboxes
- Hitboxes must match the object's visual size exactly — no invisible blockage where a small-looking object has a huge collider

## Environment
- Environment layout must be considerate and logical — no shop in the middle of a road, no tree in the middle of a path; realistic placement

## UI
- Polished, advanced UI that is not crowded, especially on mobile, so text and buttons don't eat the player's view
- Contextual buttons: show a button only when it is needed and hide it otherwise — e.g. the Enter button appears only when touching a car, the Grab button only when a grabbable object is in range

## AI opponents
- Never call AI rivals "bots" anywhere players can see — players should believe they are playing real people so the game doesn't feel cheap

## Currency
- In-game money must be in dollars ($), never pesos — the games are for a global audience

## Targeting
- Targeting matters most in fighting games: auto-lock only what is visible in the player's POV — never a target behind a building — and the camera must follow the locked target

## Art direction
- Theme and graphics must not repeat from game to game — pick the style per game: cartoonish, realistic, animatic, comic style, etc.

## Game feel (from SOL CITY feedback, Nov 20 2026)
- Hits must be felt: punches need impact, and a car hitting a person must not feel like nothing — no weak/ugly hit effects
- Fingers must close into a fist when punching — no open hands during punches
- Day-night rotation, not daytime only, along with good ambience, lighting and textures

## Claude's additions (proposed to make building better and smoother)
### Pre-build
- Plan first and get the go; in the plan list every character/vehicle with how each differs in model AND moveset, not just stats
- Decide the art style + palette up front and write it at the top of head.html so every module follows it
### Models & animation QA
- Rig every character: hips → spine → chest → neck/head; shoulders → elbows → wrists; hips → knees → ankles → toes; animate from the hips (weight shift) outward
- Walk/run: stride length tied to speed (no foot sliding), knees bend forward, opposite arm swings, torso leans with speed, head stays level; verify with a 4-phase screenshot strip before moving on
- Attack = wind-up (big, slow, weight on the back foot) → strike (fast, step forward, hip rotation) → recovery; add hit-stop, camera shake, FOV kick and impact particles; enemies telegraph before every attack
- Idle must be a real idle (breathing, weight shift), never a walk pose
### Collision & environment
- Collider per visible part (tiered boxes/capsules), never one big box; test by walking the player along edges
- Keep roads, paths and doorways clear; ground every object on the terrain (nothing floating or sunk); consistent scale between props and characters
### Camera
- Follows behind and turns with the character; drag to look, eases back only after a delay; never clips through terrain or walls; follows the locked target; no snap-backs
### UI & controls
- Big fixed joystick bottom-left, big round buttons bottom-right, at most ~5 always-visible buttons; contextual buttons appear with a short hint; HUD as small corner plates; splash preloads everything, then menu, settings, pause, results, leaderboard
### Mobile performance
- Budget about ≤80 draw calls and ≤400k triangles in view; instancing + merged static geometry; distance culling; auto quality drop under 30 fps; test portrait 720×1280 and landscape 1280×720
### Delivery checklist (before showing or publishing)
- Boots with no console errors; full loop playable (start → fight → win/lose → results → retry/menu); save/load and leaderboard calls work; buttons reachable with thumbs; phase screenshots sent; draft saved
- 2:3 thumbnail prompt + Create-a-Wish prompt given; publish only on explicit go

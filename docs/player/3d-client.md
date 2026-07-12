# Bunnyland 3D client

Bunnyland 3D is a web client for playing the same Bunnyland world through a 3D room view.
It does not add separate player rules. Your character still uses the normal actions,
inventory, action points, focus points, command queue, room exits, and server validation.

Use it when you want a spatial view of a room, remembered nearby rooms, clickable exits,
clickable targets, and screenshots of the scene.

## Open the client

Open the 3D add-on page from the Bunnyland site. On a hosted deployment, the server field is
usually already set to `/api`. For a local server, enter the full API URL, such as
`http://127.0.0.1:8765`.

The add-on has three entry points:

| Page | Use it for |
|------|------------|
| `/3d/` | Welcome page and client picker. |
| `/3d/player.html` | Play as a character in the 3D view. |
| `/3d/admin.html` | Admin room inspector. |

Choose **Player** to play. Press **Connect**, choose a character, and claim control. If the
claim succeeds, the room view, character sheet summary, available actions, command queue, and
recent activity panels update together.

## Read the room

The center of the page is the room view. The client shows your current room, visible room
contents, exits, and nearby rooms remembered from earlier visits. Decorated outdoor rooms
also show biome-specific terrain, grouped flora and static props, ambient particles, local
lights, fog, and a skybox when the room has no roof. Grouped scenery is deliberately
noninteractive; selectable or collidable props remain ordinary ECS entities.

The server remains authoritative. If a target is hidden, blocked by fog, in another room, or
otherwise unavailable, the client either hides the action or shows the server's rejection
after you try it.

The player requires scene schema v3 from the 3D server plugin. If capability negotiation fails, it shows a
compatibility error and does not enable character selection. Ask the server administrator to
install matching server and web add-on images. Installed plugins are discovered through
package entry points; obsolete runtime module-import flags will prevent startup.

## Move and act

Use **WASD** to walk around the current room. This local pose is visual only and remains in
place across ordinary refreshes. The server transform is used again when you enter a new room
or if the local pose becomes invalid.

Walk close to an exit to reveal its prompt, then press **E** or click **Travel** to queue the
normal `move` action. The move spends action points the same way it does in the terminal,
Discord, REPL, or Toon client.

Click a visible character, item, or prop to select it as the current target. The action panel
then filters and labels actions around that target. You can also search actions directly from
the action box.

Actions use the same verbs as every other Bunnyland client:

- room actions, such as move, take, drop, use, eat, drink, and say, spend action points;
- focus actions, such as notes and memory actions, spend focus points;
- queued actions appear in the queue panel and can be cancelled before they run;
- the server can still reject an action if the target or world state changed.

## Use the camera and HUD

The third-person camera follows your locally controlled avatar. It shortens its follow
distance when room geometry would block the avatar, then eases back out when the view is
clear. The bundled leporid avatar includes its corrected tail placement and animation.

Use the view controls to:

- right-drag the room view to orbit;
- use the wheel to change follow distance;
- click a visible character or object to target it;
- capture the current canvas as a PNG;
- use **Panels** to show or hide detailed character, room, action, queue, photo, and activity
  controls;
- read the remembered-room map in the panels without leaving the character view.

Plugin-owned room decorations and models are part of the same scene contract. Outdoor rooms
can show stable grouped flora, detail props, lights, and particles before any player action;
reloads update those owned entities idempotently rather than adding duplicates.

The capture button downloads the current canvas only. It is useful for player notes,
feedback, and bug reports. Server-generated scene images are separate and appear in the
photo gallery when image generation is enabled.

## Remembered rooms

The player client stores remembered rooms in browser `localStorage` per server and
character. This lets previously visited rooms stay visible after refresh while their contents
remain hidden until you can perceive them again.

If the map looks stale, reconnect or clear the browser's site storage for the Bunnyland host.
This only clears your local view memory; it does not change the server world.

## Give control back

Use the claim dialog to release your claim, switch fallback behavior, or let another
controller resume control. Once released, your character can be claimed by another client or
handled by its configured fallback controller.

The 3D client is only one way to control a character. You can switch back to the terminal,
REPL, Discord, Toon, or character sheet workflow and continue from the same world state.

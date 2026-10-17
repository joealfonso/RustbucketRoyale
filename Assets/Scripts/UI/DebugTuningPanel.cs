using UnityEngine;
using UnityEngine.InputSystem;

namespace RustbucketRoyale
{
    // Live tuning for playtests. F1 opens it and frees the cursor.
    // Uses IMGUI, which allocates every frame. Fine for a debug tool, never use it for the real HUD.
    // In the editor these sliders edit the ScriptableObject assets, so tuned values survive play mode.
    public class DebugTuningPanel : MonoBehaviour
    {
        const float CrossDistance = 2000f;

        [SerializeField] MechStats mech;
        [SerializeField] WeaponStats weapon;
        [SerializeField] MechMovement movement;
        [SerializeField] PlayerInputReader input;

        bool visible;
        Vector2 scroll;

        void Update()
        {
            if (Keyboard.current != null && Keyboard.current.f1Key.wasPressedThisFrame)
            {
                visible = !visible;
                input.SetCursorFree(visible);
            }
        }

        void OnGUI()
        {
            if (!visible)
            {
                GUI.Label(new Rect(20f, 10f, 400f, 20f), "F1: tuning panel   Esc: free cursor");
                return;
            }

            GUILayout.BeginArea(new Rect(20f, 10f, 360f, Screen.height - 80f), GUI.skin.box);
            scroll = GUILayout.BeginScrollView(scroll);

            GUILayout.Label($"Speed {movement.HorizontalSpeed:0.0} m/s    {(movement.IsGrounded ? "grounded" : "airborne")}");
            GUILayout.Label($"Cross {CrossDistance:0} m at run speed: {mech.SecondsToCross(CrossDistance):0} s");

            GUILayout.Label("Speed");
            Slider("Walk speed", ref mech.walkSpeed, 1f, 30f);
            Slider("Run speed", ref mech.runSpeed, 1f, 60f);
            Slider("Acceleration", ref mech.acceleration, 1f, 150f);
            Slider("Deceleration", ref mech.deceleration, 1f, 150f);
            Slider("Air control", ref mech.airControl, 0f, 1f);
            Slider("Body turn speed", ref mech.turnSpeedDegrees, 30f, 720f);
            Slider("Gravity", ref mech.gravity, 5f, 80f);

            GUILayout.Label("Jump jets");
            Slider("Lift", ref mech.jetLift, 5f, 150f);
            Slider("Max rise speed", ref mech.jetMaxRiseSpeed, 2f, 40f);
            Slider("Fuel max", ref mech.fuelMax, 10f, 300f);
            Slider("Fuel drain / s", ref mech.fuelDrainPerSecond, 1f, 150f);
            Slider("Fuel regen / s", ref mech.fuelRegenPerSecond, 1f, 150f);

            GUILayout.Label("Run stamina");
            Slider("Stamina max", ref mech.staminaMax, 10f, 300f);
            Slider("Run drain / s", ref mech.runDrainPerSecond, 1f, 150f);
            Slider("Stamina regen / s", ref mech.staminaRegenPerSecond, 1f, 150f);

            GUILayout.Label("Look");
            Slider("Mouse sensitivity", ref mech.mouseSensitivity, 0.02f, 0.5f);

            GUILayout.Label("Weapon");
            Slider("Shots / s", ref weapon.shotsPerSecond, 0.5f, 30f);
            Slider("Projectile speed", ref weapon.projectileSpeed, 10f, 400f);
            Slider("Spread", ref weapon.spreadDegrees, 0f, 10f);
            Slider("Shot shake", ref weapon.shakeForce, 0f, 2f);

            GUILayout.EndScrollView();
            GUILayout.EndArea();
        }

        static void Slider(string label, ref float value, float min, float max)
        {
            GUILayout.BeginHorizontal();
            GUILayout.Label(label, GUILayout.Width(130f));
            value = GUILayout.HorizontalSlider(value, min, max, GUILayout.Width(150f));
            GUILayout.Label(value.ToString("0.##"), GUILayout.Width(45f));
            GUILayout.EndHorizontal();
        }
    }
}

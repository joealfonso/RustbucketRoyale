using UnityEngine;

namespace RustbucketRoyale
{
    // Every mech movement tuning number. All values are first guesses to be tuned by feel in playtests.
    [CreateAssetMenu(menuName = "Rustbucket/Mech Stats", fileName = "MechStats")]
    public class MechStats : ScriptableObject
    {
        [Header("Speed")]
        public float walkSpeed = 8f;
        public float runSpeed = 16f;
        [Tooltip("Higher is snappier. Lower feels heavier.")]
        public float acceleration = 40f;
        public float deceleration = 50f;
        [Range(0f, 1f)] public float airControl = 0.4f;
        [Tooltip("How fast the body swings round to face where the camera looks.")]
        public float turnSpeedDegrees = 240f;
        public float gravity = 30f;

        [Header("Jump jets")]
        public float jetLift = 55f;
        public float jetMaxRiseSpeed = 14f;
        public float fuelMax = 100f;
        public float fuelDrainPerSecond = 40f;
        public float fuelRegenPerSecond = 25f;
        public float fuelRegenDelay = 1f;
        [Range(0f, 1f)] public float fuelUnlockFraction = 0.25f;

        [Header("Run stamina")]
        public float staminaMax = 100f;
        public float runDrainPerSecond = 25f;
        public float staminaRegenPerSecond = 20f;
        public float staminaRegenDelay = 1f;
        [Range(0f, 1f)] public float staminaUnlockFraction = 0.3f;

        [Header("Camera look")]
        [Tooltip("Degrees of turn per pixel of mouse movement.")]
        public float mouseSensitivity = 0.1f;
        public float minPitch = -30f;
        public float maxPitch = 60f;

        // The M1 gate asks how long it takes to cross a 2000 m map at run speed.
        public float SecondsToCross(float meters)
        {
            return runSpeed > 0f ? meters / runSpeed : float.PositiveInfinity;
        }
    }
}

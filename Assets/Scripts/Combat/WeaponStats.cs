using UnityEngine;

namespace RustbucketRoyale
{
    // Weapon tuning and art hooks. Swap the prefabs and the sound here without touching code.
    [CreateAssetMenu(menuName = "Rustbucket/Weapon Stats", fileName = "WeaponStats")]
    public class WeaponStats : ScriptableObject
    {
        [Header("Tuning")]
        public float shotsPerSecond = 6f;
        public float projectileSpeed = 120f;
        public float projectileLifetime = 3f;
        [Tooltip("Random cone half angle in degrees.")]
        public float spreadDegrees = 0.8f;
        public float maxAimDistance = 300f;
        [Tooltip("The camera sits behind the mech. The aim ray starts this far in front of the camera so it skips our own body.")]
        public float aimRayStartOffset = 7f;
        [Tooltip("Screen shake strength per shot. Off by default: it made the camera bounce while firing.")]
        public float shakeForce = 0f;

        [Header("Art hooks")]
        public GameObject projectilePrefab;
        public GameObject impactPrefab;
        public GameObject muzzleFlashPrefab;
        public AudioClip fireSound;
    }
}

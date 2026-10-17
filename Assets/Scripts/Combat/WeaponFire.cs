using Unity.Cinemachine;
using UnityEngine;

namespace RustbucketRoyale
{
    // Fires pooled projectiles at whatever the crosshair points at.
    // GUESS: for now shots aim from the muzzle to the camera ray's hit point. The rule for when
    // the camera ray and the barrel disagree is still open in docs/DECISIONS.md (decide at M3).
    public class WeaponFire : MonoBehaviour
    {
        [SerializeField] WeaponStats weapon;
        [SerializeField] PlayerInputReader input;
        [SerializeField] Transform muzzle;
        [SerializeField] AudioSource audioSource;
        [SerializeField] CinemachineImpulseSource impulse;

        PrefabPool projectiles;
        PrefabPool impacts;
        PrefabPool flashes;
        Camera cam;
        float nextShotTime;

        void Start()
        {
            cam = Camera.main;
            Transform poolRoot = new GameObject("Weapon Pools").transform;
            projectiles = new PrefabPool(weapon.projectilePrefab, poolRoot, 32);
            impacts = new PrefabPool(weapon.impactPrefab, poolRoot, 16);
            flashes = new PrefabPool(weapon.muzzleFlashPrefab, poolRoot, 4);
        }

        void Update()
        {
            if (!input.Current.Fire || Time.time < nextShotTime)
                return;
            nextShotTime = Time.time + 1f / weapon.shotsPerSecond;
            Fire();
        }

        void Fire()
        {
            Ray aim = cam.ViewportPointToRay(new Vector3(0.5f, 0.5f, 0f));
            Vector3 start = aim.origin + aim.direction * weapon.aimRayStartOffset;
            float range = weapon.maxAimDistance;

            Vector3 target = start + aim.direction * range;
            if (OwnerRaycast.Cast(start, aim.direction, range, transform, out RaycastHit hit))
                target = hit.point;

            Vector3 direction = (target - muzzle.position).normalized;
            Vector2 spread = Random.insideUnitCircle * weapon.spreadDegrees;
            direction = Quaternion.AngleAxis(spread.x, muzzle.up) * Quaternion.AngleAxis(spread.y, muzzle.right) * direction;

            GameObject bullet = projectiles.Get(muzzle.position, Quaternion.LookRotation(direction));
            bullet.GetComponent<Projectile>().Launch(projectiles, impacts, transform, direction * weapon.projectileSpeed, weapon.projectileLifetime);

            flashes.Get(muzzle.position, muzzle.rotation);
            if (weapon.fireSound != null)
                audioSource.PlayOneShot(weapon.fireSound);
            impulse.GenerateImpulse(weapon.shakeForce);
        }
    }
}

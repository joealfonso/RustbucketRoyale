using UnityEngine;

namespace RustbucketRoyale
{
    // Fast bullet that sweeps a ray each frame so it cannot tunnel through thin walls.
    public class Projectile : MonoBehaviour
    {
        PrefabPool ownPool;
        PrefabPool impactPool;
        Transform owner;
        Vector3 velocity;
        float timeLeft;

        public void Launch(PrefabPool own, PrefabPool impacts, Transform ownerRoot, Vector3 launchVelocity, float lifetime)
        {
            ownPool = own;
            impactPool = impacts;
            owner = ownerRoot;
            velocity = launchVelocity;
            timeLeft = lifetime;
        }

        void Update()
        {
            float dt = Time.deltaTime;
            Vector3 step = velocity * dt;
            float distance = step.magnitude;

            if (OwnerRaycast.Cast(transform.position, step / distance, distance, owner, out RaycastHit hit))
            {
                impactPool.Get(hit.point, Quaternion.LookRotation(hit.normal));
                ownPool.Return(gameObject);
                return;
            }

            transform.position += step;
            timeLeft -= dt;
            if (timeLeft <= 0f)
                ownPool.Return(gameObject);
        }
    }
}

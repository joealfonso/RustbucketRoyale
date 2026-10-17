using UnityEngine;

namespace RustbucketRoyale
{
    // Put on any short-lived effect prefab (muzzle flash, impact). It hands itself back to its pool.
    public class PooledEffect : MonoBehaviour
    {
        [SerializeField] float lifetime = 0.15f;

        PrefabPool pool;
        float timeLeft;

        public void Begin(PrefabPool owner)
        {
            pool = owner;
            timeLeft = lifetime;
        }

        void Update()
        {
            timeLeft -= Time.deltaTime;
            if (timeLeft <= 0f)
                pool.Return(gameObject);
        }
    }
}

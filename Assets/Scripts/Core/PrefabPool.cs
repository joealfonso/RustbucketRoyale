using System.Collections.Generic;
using UnityEngine;

namespace RustbucketRoyale
{
    // Plain pool for projectiles and effects. Nothing is instantiated after prewarm unless the pool runs dry.
    public class PrefabPool
    {
        readonly Stack<GameObject> free = new Stack<GameObject>();
        readonly GameObject prefab;
        readonly Transform parent;

        public PrefabPool(GameObject prefab, Transform parent, int prewarm)
        {
            this.prefab = prefab;
            this.parent = parent;
            for (int i = 0; i < prewarm; i++)
                free.Push(Create());
        }

        public GameObject Get(Vector3 position, Quaternion rotation)
        {
            GameObject go = free.Count > 0 ? free.Pop() : Create();
            go.transform.SetPositionAndRotation(position, rotation);
            go.SetActive(true);
            if (go.TryGetComponent(out PooledEffect effect))
                effect.Begin(this);
            return go;
        }

        public void Return(GameObject go)
        {
            go.SetActive(false);
            free.Push(go);
        }

        GameObject Create()
        {
            GameObject go = Object.Instantiate(prefab, parent);
            go.SetActive(false);
            return go;
        }
    }
}

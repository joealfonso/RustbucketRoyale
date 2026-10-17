using UnityEngine;

namespace RustbucketRoyale
{
    // Raycast that skips everything under one root, so a mech never shoots or aims at itself.
    // No custom physics layers yet, so this stands in for a layer mask.
    public static class OwnerRaycast
    {
        static readonly RaycastHit[] buffer = new RaycastHit[16];

        public static bool Cast(Vector3 origin, Vector3 direction, float distance, Transform ignoreRoot, out RaycastHit nearest)
        {
            int count = Physics.RaycastNonAlloc(origin, direction, buffer, distance, ~0, QueryTriggerInteraction.Ignore);
            nearest = default;
            float best = float.MaxValue;
            bool found = false;
            for (int i = 0; i < count; i++)
            {
                if (ignoreRoot != null && buffer[i].collider.transform.IsChildOf(ignoreRoot))
                    continue;
                if (buffer[i].distance < best)
                {
                    best = buffer[i].distance;
                    nearest = buffer[i];
                    found = true;
                }
            }
            return found;
        }
    }
}

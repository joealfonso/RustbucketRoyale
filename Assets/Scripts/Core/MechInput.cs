using UnityEngine;

namespace RustbucketRoyale
{
    // One struct for every driver. Humans fill it from the keyboard now, bots will fill it later,
    // so the mech never needs to know who is controlling it.
    public struct MechInput
    {
        public Vector2 Move;
        public Vector2 Look;
        public bool Run;
        public bool Jet;
        public bool Fire;
    }
}

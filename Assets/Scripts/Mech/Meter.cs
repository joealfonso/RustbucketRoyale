using UnityEngine;

namespace RustbucketRoyale
{
    // A resource that drains while used, waits, then refills. Used for jet fuel and run stamina.
    // When it hits empty it locks until it has refilled past unlockFraction, so jets do not flutter at zero.
    public class Meter
    {
        public float Max;
        public float Value;
        public bool Locked { get; private set; }

        float regenTimer;

        public Meter(float max)
        {
            Max = max;
            Value = max;
        }

        public float Fraction => Max > 0f ? Value / Max : 0f;
        public bool CanUse => !Locked && Value > 0f;

        public void Drain(float amount, float regenDelay)
        {
            Value = Mathf.Max(0f, Value - amount);
            regenTimer = regenDelay;
            if (Value <= 0f)
                Locked = true;
        }

        public void Regen(float perSecond, float deltaTime, float unlockFraction)
        {
            if (regenTimer > 0f)
            {
                regenTimer -= deltaTime;
                return;
            }

            Value = Mathf.Min(Max, Value + perSecond * deltaTime);
            if (Locked && Fraction >= unlockFraction)
                Locked = false;
        }

        // The debug panel can change Max live, so clamp Value to follow it.
        public void SetMax(float max)
        {
            Max = max;
            Value = Mathf.Min(Value, max);
        }
    }
}

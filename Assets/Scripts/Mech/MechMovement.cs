using UnityEngine;

namespace RustbucketRoyale
{
    // Walk, run, and jump jets. Weight comes from acceleration and the slow body turn, not from slow top speed.
    [RequireComponent(typeof(CharacterController))]
    public class MechMovement : MonoBehaviour
    {
        [SerializeField] MechStats stats;
        [SerializeField] PlayerInputReader input;
        [SerializeField] AimLook aim;

        CharacterController controller;
        Vector3 horizontalVelocity;
        float verticalVelocity;
        bool grounded;

        public Meter Fuel { get; private set; }
        public Meter Stamina { get; private set; }
        public bool IsRunning { get; private set; }
        public bool IsJetting { get; private set; }
        public bool IsGrounded => grounded;
        public float HorizontalSpeed => horizontalVelocity.magnitude;

        void Awake()
        {
            controller = GetComponent<CharacterController>();
            // The default of 1 mm drops the tiny stay-on-ground move at very high frame rates, so grounded flickers.
            controller.minMoveDistance = 0f;
            Fuel = new Meter(stats.fuelMax);
            Stamina = new Meter(stats.staminaMax);
        }

        void Update()
        {
            float dt = Time.deltaTime;
            MechInput command = input.Current;

            Fuel.SetMax(stats.fuelMax);
            Stamina.SetMax(stats.staminaMax);

            float yaw = Mathf.MoveTowardsAngle(transform.eulerAngles.y, aim.Yaw, stats.turnSpeedDegrees * dt);
            transform.rotation = Quaternion.Euler(0f, yaw, 0f);

            // Movement is relative to where the camera looks, not where the body faces.
            Vector3 wish = Quaternion.Euler(0f, aim.Yaw, 0f) * new Vector3(command.Move.x, 0f, command.Move.y);
            if (wish.sqrMagnitude > 1f)
                wish.Normalize();
            bool moving = wish.sqrMagnitude > 0.0001f;

            IsRunning = command.Run && moving && Stamina.CanUse;
            if (IsRunning)
                Stamina.Drain(stats.runDrainPerSecond * dt, stats.staminaRegenDelay);
            else
                Stamina.Regen(stats.staminaRegenPerSecond, dt, stats.staminaUnlockFraction);

            float topSpeed = IsRunning ? stats.runSpeed : stats.walkSpeed;
            float rate = (moving ? stats.acceleration : stats.deceleration) * (grounded ? 1f : stats.airControl);
            horizontalVelocity = Vector3.MoveTowards(horizontalVelocity, wish * topSpeed, rate * dt);

            IsJetting = command.Jet && Fuel.CanUse;
            if (IsJetting)
            {
                Fuel.Drain(stats.fuelDrainPerSecond * dt, stats.fuelRegenDelay);
                verticalVelocity = Mathf.Min(verticalVelocity + stats.jetLift * dt, stats.jetMaxRiseSpeed);
            }
            else
            {
                Fuel.Regen(stats.fuelRegenPerSecond, dt, stats.fuelUnlockFraction);
                // A small downward push keeps the controller reporting grounded on slopes.
                verticalVelocity = grounded && verticalVelocity < 0f ? -2f : verticalVelocity - stats.gravity * dt;
            }

            // The flags from Move are steadier than controller.isGrounded, which can flicker while resting on the floor.
            CollisionFlags flags = controller.Move((horizontalVelocity + Vector3.up * verticalVelocity) * dt);
            grounded = (flags & CollisionFlags.Below) != 0;
        }
    }
}

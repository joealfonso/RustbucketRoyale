using UnityEngine;

namespace RustbucketRoyale
{
    // Mouse look. Owns the aim yaw and pitch and turns the aim pivot that the camera follows.
    public class AimLook : MonoBehaviour
    {
        [SerializeField] PlayerInputReader input;
        [SerializeField] MechStats stats;
        [SerializeField] Transform aimPivot;

        public float Yaw { get; private set; }
        public float Pitch { get; private set; }
        public Transform AimPivot => aimPivot;

        void Start()
        {
            Yaw = transform.eulerAngles.y;
        }

        void Update()
        {
            Vector2 look = input.Current.Look * stats.mouseSensitivity;
            Yaw += look.x;
            Pitch = Mathf.Clamp(Pitch - look.y, stats.minPitch, stats.maxPitch);
            aimPivot.rotation = Quaternion.Euler(Pitch, Yaw, 0f);
        }
    }
}

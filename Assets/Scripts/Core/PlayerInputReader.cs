using UnityEngine;
using UnityEngine.InputSystem;

namespace RustbucketRoyale
{
    // Reads the keyboard and mouse into a MechInput. Runs before everything that consumes it.
    [DefaultExecutionOrder(-100)]
    public class PlayerInputReader : MonoBehaviour
    {
        public MechInput Current { get; private set; }
        public bool CursorFree { get; private set; }

        void OnEnable() => SetCursorFree(false);

        public void SetCursorFree(bool free)
        {
            CursorFree = free;
            Cursor.lockState = free ? CursorLockMode.None : CursorLockMode.Locked;
            Cursor.visible = free;
        }

        void Update()
        {
            Keyboard keyboard = Keyboard.current;
            Mouse mouse = Mouse.current;
            if (keyboard == null || mouse == null)
            {
                Current = default;
                return;
            }

            if (keyboard.escapeKey.wasPressedThisFrame)
                SetCursorFree(!CursorFree);

            // With the cursor free (debug panel open) the mech ignores the mouse so clicks do not fire.
            if (CursorFree)
            {
                Current = default;
                return;
            }

            Current = new MechInput
            {
                Move = new Vector2(Axis(keyboard.dKey, keyboard.aKey), Axis(keyboard.wKey, keyboard.sKey)),
                Look = mouse.delta.ReadValue(),
                Run = keyboard.leftShiftKey.isPressed,
                Jet = keyboard.spaceKey.isPressed,
                Fire = mouse.leftButton.isPressed,
            };
        }

        static float Axis(UnityEngine.InputSystem.Controls.KeyControl positive, UnityEngine.InputSystem.Controls.KeyControl negative)
        {
            return (positive.isPressed ? 1f : 0f) - (negative.isPressed ? 1f : 0f);
        }
    }
}

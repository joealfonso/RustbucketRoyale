using UnityEngine;

namespace RustbucketRoyale
{
    // Grey-box HUD: crosshair plus fuel and stamina bars. Replaced by the real HUD at V4.
    public class SimpleHud : MonoBehaviour
    {
        [SerializeField] MechMovement mech;

        void OnGUI()
        {
            Texture2D white = Texture2D.whiteTexture;
            float cx = Screen.width * 0.5f;
            float cy = Screen.height * 0.5f;
            GUI.color = Color.white;
            GUI.DrawTexture(new Rect(cx - 2f, cy - 2f, 4f, 4f), white);

            DrawBar(new Rect(20f, Screen.height - 50f, 220f, 12f), mech.Fuel, new Color(1f, 0.6f, 0.1f));
            DrawBar(new Rect(20f, Screen.height - 30f, 220f, 12f), mech.Stamina, new Color(0.3f, 0.8f, 1f));
            GUI.color = Color.white;
        }

        static void DrawBar(Rect rect, Meter meter, Color fill)
        {
            Texture2D white = Texture2D.whiteTexture;
            GUI.color = new Color(0f, 0f, 0f, 0.6f);
            GUI.DrawTexture(rect, white);
            GUI.color = meter.Locked ? Color.red : fill;
            GUI.DrawTexture(new Rect(rect.x, rect.y, rect.width * meter.Fraction, rect.height), white);
        }
    }
}

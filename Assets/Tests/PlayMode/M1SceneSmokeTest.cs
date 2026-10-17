#if UNITY_EDITOR
using System.Collections;
using NUnit.Framework;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;
using UnityEngine.TestTools;

namespace RustbucketRoyale.Tests
{
    // Loads the grey-box scene and lets it run. Any error logged during play fails the test.
    // The scene is not in the build list, so it is loaded through the editor.
    public class M1SceneSmokeTest
    {
        [UnityTest]
        public IEnumerator SceneLoadsAndMechSettlesOnTheGround()
        {
            yield return EditorSceneManager.LoadSceneAsyncInPlayMode(
                "Assets/Scenes/M1_Greybox.unity", new LoadSceneParameters(LoadSceneMode.Single));
            yield return new WaitForSeconds(1.5f);

            var mech = Object.FindAnyObjectByType<MechMovement>();
            Assert.IsNotNull(mech, "Mech is missing from the scene");
            Assert.IsTrue(mech.IsGrounded, $"Mech did not land on the ground. y={mech.transform.position.y} pos={mech.transform.position}");
        }
    }
}
#endif

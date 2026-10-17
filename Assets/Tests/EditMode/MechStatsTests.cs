using NUnit.Framework;
using UnityEngine;

namespace RustbucketRoyale.Tests
{
    public class MechStatsTests
    {
        [Test]
        public void CrossingTimeIsDistanceOverRunSpeed()
        {
            var stats = ScriptableObject.CreateInstance<MechStats>();
            stats.runSpeed = 20f;
            Assert.AreEqual(100f, stats.SecondsToCross(2000f), 0.001f);
            Object.DestroyImmediate(stats);
        }

        [Test]
        public void ZeroRunSpeedNeverArrives()
        {
            var stats = ScriptableObject.CreateInstance<MechStats>();
            stats.runSpeed = 0f;
            Assert.IsTrue(float.IsPositiveInfinity(stats.SecondsToCross(2000f)));
            Object.DestroyImmediate(stats);
        }
    }
}

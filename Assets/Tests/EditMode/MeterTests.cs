using NUnit.Framework;

namespace RustbucketRoyale.Tests
{
    public class MeterTests
    {
        [Test]
        public void DrainingToEmptyLocksTheMeter()
        {
            var meter = new Meter(100f);
            meter.Drain(100f, 0f);
            Assert.IsTrue(meter.Locked);
            Assert.IsFalse(meter.CanUse);
        }

        [Test]
        public void StaysLockedUntilRefilledPastUnlockFraction()
        {
            var meter = new Meter(100f);
            meter.Drain(100f, 0f);

            meter.Regen(10f, 1f, 0.25f); // 10 of 100, still under 25%
            Assert.IsTrue(meter.Locked);

            meter.Regen(10f, 2f, 0.25f); // 30 of 100
            Assert.IsFalse(meter.Locked);
        }

        [Test]
        public void RegenWaitsForTheDelay()
        {
            var meter = new Meter(100f);
            meter.Drain(50f, 1f);

            meter.Regen(10f, 0.5f, 0.25f);
            Assert.AreEqual(50f, meter.Value, 0.001f);

            meter.Regen(10f, 0.5f, 0.25f);
            Assert.AreEqual(50f, meter.Value, 0.001f); // delay used up exactly, no refill yet

            meter.Regen(10f, 1f, 0.25f);
            Assert.AreEqual(60f, meter.Value, 0.001f);
        }

        [Test]
        public void LoweringMaxClampsValue()
        {
            var meter = new Meter(100f);
            meter.SetMax(40f);
            Assert.AreEqual(40f, meter.Value, 0.001f);
        }
    }
}

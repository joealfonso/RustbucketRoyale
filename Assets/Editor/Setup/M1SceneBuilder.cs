using System.IO;
using Unity.Cinemachine;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace RustbucketRoyale.EditorTools
{
    // Builds the M1 grey-box scene, prefabs, materials and default data assets.
    // Scenes and prefabs are never hand-edited, so rerun this after changing it.
    // Existing stat assets are kept, so tuned values are not overwritten.
    public static class M1SceneBuilder
    {
        const string DataDir = "Assets/Data";
        const string PrefabDir = "Assets/Prefabs";
        const string MaterialDir = "Assets/Materials";
        const string ScenePath = "Assets/Scenes/M1_Greybox.unity";

        [MenuItem("Rustbucket/Build M1 Grey-box Scene")]
        public static void Build()
        {
            EnsureFolder(DataDir);
            EnsureFolder(PrefabDir);
            EnsureFolder(MaterialDir);

            MechStats mechStats = LoadOrCreate<MechStats>($"{DataDir}/MechStats.asset");
            WeaponStats weaponStats = LoadOrCreate<WeaponStats>($"{DataDir}/WeaponStats.asset");

            Material ground = MakeMaterial("Ground", new Color(0.35f, 0.36f, 0.34f));
            Material cover = MakeMaterial("Cover", new Color(0.5f, 0.45f, 0.38f));
            Material marker = MakeMaterial("Marker", new Color(0.9f, 0.8f, 0.2f));
            Material target = MakeMaterial("Target", new Color(0.75f, 0.25f, 0.2f));
            Material mechBody = MakeMaterial("MechBody", new Color(0.45f, 0.5f, 0.55f));
            Material mechAccent = MakeMaterial("MechAccent", new Color(0.85f, 0.45f, 0.1f));
            Material glow = MakeMaterial("Glow", new Color(1f, 0.7f, 0.2f), emissive: true);

            weaponStats.projectilePrefab = MakeProjectilePrefab(glow);
            weaponStats.impactPrefab = MakeEffectPrefab("Impact", glow, 0.5f, 0.15f);
            weaponStats.muzzleFlashPrefab = MakeEffectPrefab("MuzzleFlash", glow, 0.6f, 0.05f);
            EditorUtility.SetDirty(weaponStats);

            GameObject mechPrefab = MakeMechPrefab(mechStats, weaponStats, mechBody, mechAccent);

            Scene scene = EditorSceneManager.NewScene(NewSceneSetup.DefaultGameObjects, NewSceneMode.Single);
            BuildMap(ground, cover, marker, target);

            GameObject mech = (GameObject)PrefabUtility.InstantiatePrefab(mechPrefab);
            mech.transform.position = new Vector3(0f, 0.1f, 0f);
            BuildCamera(mech.GetComponent<AimLook>().AimPivot);

            EditorSceneManager.SaveScene(scene, ScenePath);
            AssetDatabase.SaveAssets();
            Debug.Log($"M1 scene built: {ScenePath}");
        }

        static void BuildMap(Material ground, Material cover, Material marker, Material target)
        {
            // One long strip so the 2000 m run-speed test fits. Spawn is at z = 0.
            Box("Ground", new Vector3(0f, -0.5f, 1000f), new Vector3(300f, 1f, 2200f), ground);

            // Distance markers every 250 m so the crossing time can be read by eye.
            for (int z = 250; z <= 2000; z += 250)
                Box($"Marker {z} m", new Vector3(-20f, 10f, z), new Vector3(2f, 20f, 2f), marker);

            // Cover cluster, a ramp, and a tower to test the jets.
            Box("Cover A", new Vector3(12f, 1.5f, 25f), new Vector3(8f, 3f, 2f), cover);
            Box("Cover B", new Vector3(-10f, 2f, 35f), new Vector3(3f, 4f, 10f), cover);
            Box("Cover C", new Vector3(5f, 1f, 50f), new Vector3(12f, 2f, 3f), cover);
            Box("Wall", new Vector3(0f, 4f, 80f), new Vector3(40f, 8f, 1.5f), cover);
            Box("Tower", new Vector3(35f, 15f, 40f), new Vector3(10f, 30f, 10f), cover);

            GameObject ramp = Box("Ramp", new Vector3(-30f, 2f, 20f), new Vector3(12f, 1f, 18f), cover);
            ramp.transform.rotation = Quaternion.Euler(-14f, 0f, 0f);

            // Targets to shoot at. They only show impacts for now.
            for (int i = 0; i < 5; i++)
                Box($"Target {i}", new Vector3(-20f + i * 10f, 1.5f, 70f), new Vector3(2f, 3f, 2f), target);
        }

        static void BuildCamera(Transform aimPivot)
        {
            Camera camera = Camera.main;
            camera.gameObject.AddComponent<CinemachineBrain>();

            var vcam = new GameObject("Mech Camera");
            var cinemachineCamera = vcam.AddComponent<CinemachineCamera>();
            cinemachineCamera.Target.TrackingTarget = aimPivot;
            cinemachineCamera.Lens.FieldOfView = 70f;

            // Over the shoulder. IgnoreTag lets the camera ignore the mech it is following.
            var follow = vcam.AddComponent<CinemachineThirdPersonFollow>();
            follow.ShoulderOffset = new Vector3(0.9f, 0f, 0f);
            follow.VerticalArmLength = 0.2f;
            follow.CameraSide = 1f;
            follow.CameraDistance = 6f;
            follow.AvoidObstacles.CameraRadius = 0.3f;
            follow.AvoidObstacles.IgnoreTag = "Player";
            follow.Damping = new Vector3(0.1f, 0.4f, 0.2f);

            vcam.AddComponent<CinemachineImpulseListener>();
        }

        static GameObject MakeMechPrefab(MechStats mechStats, WeaponStats weaponStats, Material body, Material accent)
        {
            var root = new GameObject("Mech") { tag = "Player" };
            var controller = root.AddComponent<CharacterController>();
            controller.height = 3.4f;
            controller.radius = 0.9f;
            controller.center = new Vector3(0f, 1.7f, 0f);

            Part(root.transform, "Torso", PrimitiveType.Cube, new Vector3(0f, 2.4f, 0f), new Vector3(1.8f, 1.6f, 1.2f), body);
            Part(root.transform, "Left Leg", PrimitiveType.Cube, new Vector3(-0.6f, 0.8f, 0f), new Vector3(0.6f, 1.6f, 0.7f), body);
            Part(root.transform, "Right Leg", PrimitiveType.Cube, new Vector3(0.6f, 0.8f, 0f), new Vector3(0.6f, 1.6f, 0.7f), body);
            Part(root.transform, "Left Arm", PrimitiveType.Cube, new Vector3(-1.2f, 2.4f, 0.2f), new Vector3(0.5f, 1.2f, 0.5f), accent);
            GameObject gun = Part(root.transform, "Right Arm", PrimitiveType.Cube, new Vector3(1.2f, 2.4f, 0.6f), new Vector3(0.5f, 0.6f, 1.6f), accent);

            var muzzle = new GameObject("Muzzle").transform;
            muzzle.SetParent(gun.transform, false);
            muzzle.localPosition = new Vector3(0f, 0f, 0.6f);

            // The camera follows this. Its rotation is set every frame by AimLook, so it is a child only for position.
            var aimPivot = new GameObject("Aim Pivot").transform;
            aimPivot.SetParent(root.transform, false);
            aimPivot.localPosition = new Vector3(0f, 3.2f, 0f);

            var input = root.AddComponent<PlayerInputReader>();
            var aim = root.AddComponent<AimLook>();
            var movement = root.AddComponent<MechMovement>();
            var weapon = root.AddComponent<WeaponFire>();
            var audio = root.AddComponent<AudioSource>();
            audio.playOnAwake = false;
            audio.spatialBlend = 0f;
            var impulse = root.AddComponent<CinemachineImpulseSource>();
            impulse.ImpulseDefinition.ImpulseDuration = 0.15f;
            var hud = root.AddComponent<SimpleHud>();
            var panel = root.AddComponent<DebugTuningPanel>();

            Wire(aim, ("input", input), ("stats", mechStats), ("aimPivot", aimPivot));
            Wire(movement, ("stats", mechStats), ("input", input), ("aim", aim));
            Wire(weapon, ("weapon", weaponStats), ("input", input), ("muzzle", muzzle), ("audioSource", audio), ("impulse", impulse));
            Wire(hud, ("mech", movement));
            Wire(panel, ("mech", mechStats), ("weapon", weaponStats), ("movement", movement), ("input", input));

            string path = $"{PrefabDir}/Mech.prefab";
            GameObject prefab = PrefabUtility.SaveAsPrefabAsset(root, path);
            Object.DestroyImmediate(root);
            return prefab;
        }

        static GameObject MakeProjectilePrefab(Material glow)
        {
            var go = GameObject.CreatePrimitive(PrimitiveType.Sphere);
            go.name = "Projectile";
            go.transform.localScale = Vector3.one * 0.3f;
            Object.DestroyImmediate(go.GetComponent<Collider>());
            go.GetComponent<Renderer>().sharedMaterial = glow;
            go.AddComponent<Projectile>();
            return SavePrefab(go, "Projectile");
        }

        static GameObject MakeEffectPrefab(string name, Material glow, float size, float lifetime)
        {
            var go = GameObject.CreatePrimitive(PrimitiveType.Sphere);
            go.name = name;
            go.transform.localScale = Vector3.one * size;
            Object.DestroyImmediate(go.GetComponent<Collider>());
            go.GetComponent<Renderer>().sharedMaterial = glow;
            var effect = go.AddComponent<PooledEffect>();
            Wire(effect, ("lifetime", lifetime));
            return SavePrefab(go, name);
        }

        static GameObject SavePrefab(GameObject go, string name)
        {
            GameObject prefab = PrefabUtility.SaveAsPrefabAsset(go, $"{PrefabDir}/{name}.prefab");
            Object.DestroyImmediate(go);
            return prefab;
        }

        static GameObject Part(Transform parent, string name, PrimitiveType type, Vector3 position, Vector3 scale, Material material)
        {
            var go = GameObject.CreatePrimitive(type);
            go.name = name;
            go.transform.SetParent(parent, false);
            go.transform.localPosition = position;
            go.transform.localScale = scale;
            go.GetComponent<Renderer>().sharedMaterial = material;
            // The CharacterController is the mech's collider. Part colliders would block its own movement.
            Object.DestroyImmediate(go.GetComponent<Collider>());
            return go;
        }

        static GameObject Box(string name, Vector3 position, Vector3 scale, Material material)
        {
            var go = GameObject.CreatePrimitive(PrimitiveType.Cube);
            go.name = name;
            go.transform.position = position;
            go.transform.localScale = scale;
            go.GetComponent<Renderer>().sharedMaterial = material;
            return go;
        }

        static Material MakeMaterial(string name, Color color, bool emissive = false)
        {
            string path = $"{MaterialDir}/{name}.mat";
            var material = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (material == null)
            {
                material = new Material(Shader.Find("Universal Render Pipeline/Lit"));
                AssetDatabase.CreateAsset(material, path);
            }
            material.SetColor("_BaseColor", color);
            if (emissive)
            {
                material.EnableKeyword("_EMISSION");
                material.SetColor("_EmissionColor", color * 3f);
            }
            EditorUtility.SetDirty(material);
            return material;
        }

        static T LoadOrCreate<T>(string path) where T : ScriptableObject
        {
            var asset = AssetDatabase.LoadAssetAtPath<T>(path);
            if (asset != null)
                return asset;
            asset = ScriptableObject.CreateInstance<T>();
            AssetDatabase.CreateAsset(asset, path);
            return asset;
        }

        static void EnsureFolder(string path)
        {
            if (!AssetDatabase.IsValidFolder(path))
                AssetDatabase.CreateFolder(Path.GetDirectoryName(path).Replace('\\', '/'), Path.GetFileName(path));
        }

        // Sets private [SerializeField] fields by name so the prefab is wired without hand editing.
        static void Wire(Object target, params (string field, object value)[] fields)
        {
            var serialized = new SerializedObject(target);
            foreach (var (field, value) in fields)
            {
                SerializedProperty property = serialized.FindProperty(field);
                if (property == null)
                    throw new System.Exception($"{target.GetType().Name} has no serialized field '{field}'");
                if (value is Object reference)
                    property.objectReferenceValue = reference;
                else if (value is float number)
                    property.floatValue = number;
            }
            serialized.ApplyModifiedPropertiesWithoutUndo();
        }
    }
}

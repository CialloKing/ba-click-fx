using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using UnityEditor;
using UnityEngine;

public static partial class BaFxTouchPreviewCapture
{
    [Serializable]
    private sealed class CompareInput
    {
        public int schema;
        public CompareCase[] cases;
    }

    [Serializable]
    private sealed class CompareCase
    {
        public string name;
        public int[] captures;
        public ComparePoint[] points;
        public bool trail;
        public string drive;
        public int releaseMs;
    }

    [Serializable]
    private sealed class ComparePoint
    {
        public int timeMs;
        public float x;
        public float y;
    }

    [Serializable]
    private sealed class CompareMesh
    {
        public string name;
        public bool enabled;
        public Vector3 scale;
        public string scalingMode;
        public Color materialColor;
        public float materialIntensity;
        public Vector3[] vertices;
        public Vector2[] uv;
        public Color[] colors;
        public int[] indices;
        public Vector3[] positions;
        public float lifetime;
        public float width;
        public float widthCurveStart;
        public float widthCurveMiddle;
        public float widthCurveEnd;
        public int widthCurveKeys;
        public string alignment;
        public bool emitting;
        public Vector3 position;
        public Quaternion rotation;
        public Vector3 localPosition;
        public Quaternion localRotation;
        public Vector3 localScale;
        public Matrix4x4 localToWorld;
        public Matrix4x4 worldToLocal;
        public Matrix4x4 parentLocalToWorld;
    }

    [Serializable]
    private sealed class CompareState
    {
        public int schema = 1;
        public string name;
        public int timeMs;
        public int run;
        public float elapsedUnityTime;
        public int frame;
        public bool showParticles;
        public string drive;
        public int releaseMs;
        public ComparePoint[] inputs;
        public Matrix4x4 cameraWorldToCamera;
        public Matrix4x4 cameraProjection;
        public CompareMesh[] particles;
        public CompareMesh[] trails;
    }

    [Serializable]
    private sealed class CompareBuffer
    {
        public string name;
        public int width;
        public int height;
        public string encoding = "rgba16float-le";
        public string origin = "bottom-left";
    }

    [Serializable]
    private sealed class CompareBuffers
    {
        public float sampleScale;
        public CompareBuffer[] buffers;
    }

    private static CompareInput compareInput;
    private static string compareOutput;
    private static GameObject comparePrefab;
    private static Camera compareCamera;
    private static GameObject compareInstance;
    private static ParticleSystem[] compareSystems;
    private static TrailRenderer[] compareTrails;
    private static int compareCase;
    private static int compareRun;
    private static int compareTick;
    private static float compareStart;
    private static bool compareFinished;
    private static BaCompareTicker compareTicker;

    public static void CompareStage11()
    {
        try
        {
            string[] arguments = Environment.GetCommandLineArgs();
            int outputIndex = Array.IndexOf(arguments, "-baCompareOutput");
            compareOutput = arguments[outputIndex + 1];
            compareRun = int.Parse(arguments[Array.IndexOf(arguments, "-baCompareRun") + 1]);
            compareInput = JsonUtility.FromJson<CompareInput>(
                File.ReadAllText(Path.Combine(compareOutput, "inputs.json")));
            if (Application.unityVersion != "2021.3.45f1" || (compareInput.schema != 1 && compareInput.schema != 2))
            {
                throw new InvalidOperationException("Unity 版本或对照输入版本不匹配");
            }
            PrepareCapture(compareOutput, out comparePrefab, out compareCamera);
            compareCamera.enabled = true;
            EditorApplication.ExecuteMenuItem("Window/General/Game");
            foreach (ParticleSystem system in UnityEngine.Object.FindObjectsOfType<ParticleSystem>())
            {
                system.gameObject.SetActive(false);
            }
            foreach (MonoBehaviour behaviour in UnityEngine.Object.FindObjectsOfType<MonoBehaviour>())
            {
                if (behaviour.GetType().Name.StartsWith("Ba") || behaviour.GetType().Name == "BundleMouseFxPreview")
                {
                    behaviour.enabled = false;
                }
            }
            // 只保存隔离副本的验证场景，避免正常图形模式退出时弹出未保存提示。
            UnityEditor.SceneManagement.EditorSceneManager.SaveScene(
                UnityEngine.SceneManagement.SceneManager.GetActiveScene());
            Application.runInBackground = true;
            EditorApplication.ExecuteMenuItem("Window/General/Game");
            EditorApplication.update += CompareEditorTick;
            // 静态引用和预配置场景只在该隔离工程的这次捕获中保留。
            EditorSettings.enterPlayModeOptionsEnabled = true;
            EditorSettings.enterPlayModeOptions = EnterPlayModeOptions.DisableDomainReload |
                EnterPlayModeOptions.DisableSceneReload;
            EditorApplication.playModeStateChanged += ComparePlayMode;
            EditorApplication.isPlaying = true;
        }
        catch (Exception error)
        {
            CompareFail(error);
        }
    }

    private static void CompareEditorTick()
    {
        if (!compareFinished)
        {
            // 隐藏的验证窗口也必须执行真实图形帧，才能推进 TrailRenderer 的原生更新。
            EditorApplication.QueuePlayerLoopUpdate();
            UnityEditorInternal.InternalEditorUtility.RepaintAllViews();
        }
    }

    private static void ComparePlayMode(PlayModeStateChange state)
    {
        if (state == PlayModeStateChange.EnteredEditMode && compareFinished)
        {
            // 先完成 PlayerLoop 和场景资源清理，再从编辑器循环退出。
            EditorApplication.delayCall += () => EditorApplication.Exit(0);
            return;
        }
        if (state != PlayModeStateChange.EnteredPlayMode)
        {
            return;
        }
        try
        {
            Time.captureDeltaTime = 0.01f;
            Time.timeScale = 1.0f;
            CompareSetup();
            compareTicker = new GameObject("BA compare ticker").AddComponent<BaCompareTicker>();
            compareTicker.Advance = CompareAdvance;
            compareTicker.Capture = CompareCapture;
        }
        catch (Exception error)
        {
            CompareFail(error);
        }
    }

    private static Vector3 CompareWorld(ComparePoint point)
    {
        return BaGameBloomRendererFeature.ScreenToUiWorldPosition(
            new Vector3(point.x, CaptureHeight - point.y, 0.0f), CaptureWidth, CaptureHeight);
    }

    private static void CompareSetup()
    {
        CompareCase specification = compareInput.cases[compareCase];
        compareTick = 0;
        compareStart = Time.time;
        compareInstance = CreateCaptureInstance(comparePrefab,
            CompareWorld(specification.points[0]), specification.name);
        compareSystems = InitializeParticleSystems(compareInstance, DeterministicSeedBase);
        ConfigureParticleRenderers(compareInstance, !specification.trail);
        foreach (ParticleSystem system in compareSystems)
        {
            system.Pause(false);
        }
        compareTrails = compareInstance.GetComponentsInChildren<TrailRenderer>(true);
        foreach (TrailRenderer trail in compareTrails)
        {
            trail.Clear();
            trail.enabled = specification.trail;
            trail.emitting = specification.trail && specification.drive == "runtime";
            if (specification.trail && specification.drive != "runtime")
            {
                foreach (ComparePoint point in specification.points)
                {
                    if (point.timeMs == 0)
                    {
                        trail.AddPosition(CompareWorld(point));
                    }
                }
            }
        }
    }

    private static void CompareAdvance()
    {
        try
        {
            compareTick++;
            CompareCase specification = compareInput.cases[compareCase];
            foreach (ComparePoint point in specification.points)
            {
                if (point.timeMs == compareTick * 10)
                {
                    compareInstance.transform.position = CompareWorld(point);
                    if (specification.trail && specification.drive != "runtime")
                    {
                        foreach (TrailRenderer trail in compareTrails)
                        {
                            trail.AddPosition(CompareWorld(point));
                        }
                    }
                }
            }
            if (specification.releaseMs > 0 && compareTick * 10 >= specification.releaseMs)
            {
                foreach (TrailRenderer trail in compareTrails)
                {
                    trail.emitting = false;
                }
            }
            SimulateParticleSystems(compareSystems, 0.01f);
        }
        catch (Exception error)
        {
            CompareFail(error);
        }
    }

    private static CompareMesh CompareBake(Renderer renderer)
    {
        Mesh mesh = new Mesh();
        try
        {
            ParticleSystemRenderer particles = renderer as ParticleSystemRenderer;
            TrailRenderer trail = renderer as TrailRenderer;
            if (particles != null)
            {
                particles.BakeMesh(mesh, compareCamera, true);
            }
            else
            {
                trail.BakeMesh(mesh, compareCamera, true);
            }
            Material material = renderer.sharedMaterial;
            Vector3[] positions = new Vector3[trail == null ? 0 : trail.positionCount];
            trail?.GetPositions(positions);
            return new CompareMesh
            {
                name = renderer.gameObject.name,
                enabled = renderer.enabled,
                scale = renderer.transform.lossyScale,
                scalingMode = particles == null ? "World" : particles.GetComponent<ParticleSystem>().main.scalingMode.ToString(),
                materialColor = material == null ? Color.white : material.GetColor("_BaseColor"),
                materialIntensity = material != null && material.HasProperty("_Intensity") ? material.GetFloat("_Intensity") : 1.0f,
                vertices = mesh.vertices,
                uv = mesh.uv,
                colors = mesh.colors,
                indices = mesh.triangles,
                positions = positions,
                lifetime = trail == null ? 0.0f : trail.time,
                width = trail == null ? 0.0f : trail.widthMultiplier,
                widthCurveStart = trail == null ? 0.0f : trail.widthCurve.Evaluate(0.0f),
                widthCurveMiddle = trail == null ? 0.0f : trail.widthCurve.Evaluate(0.5f),
                widthCurveEnd = trail == null ? 0.0f : trail.widthCurve.Evaluate(1.0f),
                widthCurveKeys = trail == null ? 0 : trail.widthCurve.length,
                alignment = trail == null ? "" : trail.alignment.ToString(),
                emitting = trail != null && trail.emitting,
                position = renderer.transform.position,
                rotation = renderer.transform.rotation,
                localPosition = renderer.transform.localPosition,
                localRotation = renderer.transform.localRotation,
                localScale = renderer.transform.localScale,
                localToWorld = renderer.transform.localToWorldMatrix,
                worldToLocal = renderer.transform.worldToLocalMatrix,
                parentLocalToWorld = renderer.transform.parent == null ? Matrix4x4.identity : renderer.transform.parent.localToWorldMatrix
            };
        }
        finally
        {
            UnityEngine.Object.DestroyImmediate(mesh);
        }
    }

    private static void CompareWriteRaw(RenderTexture texture, string path)
    {
        RenderTexture previous = RenderTexture.active;
        Texture2D image = null;
        try
        {
            RenderTexture.active = texture;
            image = new Texture2D(texture.width, texture.height, TextureFormat.RGBAHalf, false, true);
            image.ReadPixels(new Rect(0, 0, texture.width, texture.height), 0, 0);
            image.Apply(false, false);
            byte[] bytes = image.GetRawTextureData<byte>().ToArray();
            using (FileStream file = File.Create(path))
            using (GZipStream gzip = new GZipStream(file, CompressionMode.Compress))
            {
                gzip.Write(bytes, 0, bytes.Length);
            }
        }
        finally
        {
            RenderTexture.active = previous;
            if (image != null)
            {
                UnityEngine.Object.DestroyImmediate(image);
            }
        }
    }

    private static void CompareCapture()
    {
        try
        {
            CompareCase specification = compareInput.cases[compareCase];
            int milliseconds = compareTick * 10;
            if (Array.IndexOf(specification.captures, milliseconds) >= 0)
            {
                string directory = Path.Combine(compareOutput, "reference",
                    "run" + compareRun, specification.name + "-" + milliseconds);
                Directory.CreateDirectory(directory);
                byte[] particleState = SerializeParticleStateFixture(compareInstance,
                    compareSystems, compareCamera, milliseconds);
                File.WriteAllText(Path.Combine(directory, "particles.json"),
                    System.Text.Encoding.UTF8.GetString(particleState).Replace(
                        "\"runs\":2,\"byteIdentical\":true", "\"runs\":1,\"byteIdentical\":false"));
                List<CompareMesh> particles = new List<CompareMesh>();
                foreach (ParticleSystemRenderer renderer in compareInstance.GetComponentsInChildren<ParticleSystemRenderer>())
                {
                    particles.Add(CompareBake(renderer));
                }
                List<CompareMesh> trails = new List<CompareMesh>();
                foreach (TrailRenderer trail in compareTrails)
                {
                    trails.Add(CompareBake(trail));
                }
                File.WriteAllText(Path.Combine(directory, "state.json"), JsonUtility.ToJson(new CompareState
                {
                    schema = compareInput.schema,
                    name = specification.name,
                    timeMs = milliseconds,
                    run = compareRun,
                    elapsedUnityTime = Time.time - compareStart,
                    frame = Time.frameCount,
                    showParticles = !specification.trail,
                    drive = specification.drive,
                    releaseMs = specification.releaseMs,
                    inputs = specification.points,
                    cameraWorldToCamera = compareCamera.worldToCameraMatrix,
                    cameraProjection = compareCamera.projectionMatrix,
                    particles = particles.ToArray(),
                    trails = trails.ToArray()
                }));
                using (BaGameBloomRendererFeature.DiagnosticCapture capture =
                    BaGameBloomRendererFeature.BeginDiagnosticCapture(compareCamera,
                        BaGameBloomRendererFeature.DiagnosticOutputAttachment.IndependentUiPassOutput))
                {
                    RenderFrame(compareCamera, milliseconds / 1000.0f, directory, "final", 1);
                    List<CompareBuffer> buffers = new List<CompareBuffer>();
                    foreach (BaGameBloomRendererFeature.DiagnosticTexture buffer in capture.Textures)
                    {
                        CompareWriteRaw(buffer.Texture, Path.Combine(directory, buffer.Name + ".rgba16f.gz"));
                        WriteSrgbPreviewPng(buffer.Texture, Path.Combine(directory, buffer.Name + ".png"));
                        buffers.Add(new CompareBuffer { name = buffer.Name, width = buffer.Texture.width, height = buffer.Texture.height });
                    }
                    if (buffers.Count == 0)
                    {
                        throw new InvalidOperationException("没有捕获到 HDR 中间缓冲");
                    }
                    File.WriteAllText(Path.Combine(directory, "buffers.json"), JsonUtility.ToJson(
                        new CompareBuffers { sampleScale = capture.SampleScale, buffers = buffers.ToArray() }));
                }
                File.WriteAllText(Path.Combine(compareOutput, "progress.txt"), directory);
                Debug.Log("BA compare captured " + directory);
            }
            if (milliseconds >= specification.captures[specification.captures.Length - 1])
            {
                UnityEngine.Object.DestroyImmediate(compareInstance);
                compareCase++;
                if (compareCase == compareInput.cases.Length)
                {
                    File.WriteAllText(Path.Combine(compareOutput, "run" + compareRun + "-complete.json"), "{\"completed\":true}");
                    compareFinished = true;
                    compareTicker.Advance = null;
                    compareTicker.Capture = null;
                    EditorApplication.delayCall += () =>
                    {
                        EditorApplication.Exit(0);
                    };
                    return;
                }
                CompareSetup();
            }
        }
        catch (Exception error)
        {
            CompareFail(error);
        }
    }

    private static void CompareFail(Exception error)
    {
        Debug.LogException(error);
        if (!string.IsNullOrEmpty(compareOutput))
        {
            try
            {
                File.WriteAllText(Path.Combine(compareOutput, "failure.txt"), error.ToString());
            }
            catch (Exception diagnosticError)
            {
                Debug.LogWarning(diagnosticError.Message);
            }
        }
        EditorApplication.Exit(1);
    }
}

using UnityEngine;
using UnityEngine.UIElements;

namespace NodeGraph.App
{
    public static class GraphRuntimeBootstrap
    {
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        private static void CreateRuntimeEditor()
        {
            if (Object.FindFirstObjectByType<GraphLifetimeScope>() != null)
            {
                return;
            }

            var root = new GameObject("NodeGraphEditorRuntime");
            Object.DontDestroyOnLoad(root);

            var document = root.AddComponent<UIDocument>();
            var panelSettings = ScriptableObject.CreateInstance<PanelSettings>();
            panelSettings.themeStyleSheet = Resources.Load<ThemeStyleSheet>("NodeGraph/UnityDefaultRuntimeTheme");

            if (panelSettings.themeStyleSheet == null)
            {
                Debug.LogError("Missing runtime UI Toolkit theme at Resources/NodeGraph/UnityDefaultRuntimeTheme.tss.");
            }

            document.panelSettings = panelSettings;
            root.AddComponent<GraphEditorHost>();
            root.AddComponent<GraphLifetimeScope>();
        }
    }
}

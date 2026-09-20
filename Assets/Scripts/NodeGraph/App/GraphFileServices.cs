using System;
using System.IO;
using System.Text;
using Cysharp.Threading.Tasks;
using NodeGraph.Core;
using NodeGraph.Serialization;
using SFB;

namespace NodeGraph.App
{
    public interface IGraphFileDialog
    {
        UniTask<string> OpenAsync();
        UniTask<string> SaveAsync(string currentPath);
    }

    public sealed class SfbGraphFileDialog : IGraphFileDialog
    {
        private static readonly ExtensionFilter[] JsonFilters =
        {
            new ExtensionFilter("JSON graph", "json")
        };

        public UniTask<string> OpenAsync()
        {
            var source = new UniTaskCompletionSource<string>();
            StandaloneFileBrowser.OpenFilePanelAsync(
                "Open node graph",
                string.Empty,
                JsonFilters,
                false,
                paths => source.TrySetResult(paths != null && paths.Length > 0 ? paths[0] : null));
            return source.Task;
        }

        public UniTask<string> SaveAsync(string currentPath)
        {
            var directory = string.IsNullOrWhiteSpace(currentPath)
                ? string.Empty
                : Path.GetDirectoryName(currentPath);
            var defaultName = string.IsNullOrWhiteSpace(currentPath)
                ? "graph.json"
                : Path.GetFileName(currentPath);
            var source = new UniTaskCompletionSource<string>();
            StandaloneFileBrowser.SaveFilePanelAsync(
                "Save node graph",
                directory,
                defaultName,
                JsonFilters,
                path => source.TrySetResult(string.IsNullOrWhiteSpace(path) ? null : path));
            return source.Task;
        }
    }

    public sealed class GraphFileService
    {
        private readonly GraphJsonSerializer _serializer;

        public GraphFileService(GraphJsonSerializer serializer)
        {
            _serializer = serializer ?? throw new ArgumentNullException(nameof(serializer));
        }

        public async UniTask<GraphLoadResult> LoadAsync(string path)
        {
            if (string.IsNullOrWhiteSpace(path))
            {
                throw new ArgumentException("A graph path is required.", nameof(path));
            }
            if (!File.Exists(path))
            {
                throw new FileNotFoundException("Graph file was not found.", path);
            }

            var json = await File.ReadAllTextAsync(path);
            return _serializer.Deserialize(json);
        }

        public async UniTask SaveAsync(GraphModel graph, string path)
        {
            if (graph == null)
            {
                throw new ArgumentNullException(nameof(graph));
            }
            if (string.IsNullOrWhiteSpace(path))
            {
                throw new ArgumentException("A graph path is required.", nameof(path));
            }

            var json = _serializer.Serialize(graph);
            var directory = Path.GetDirectoryName(path);
            if (!string.IsNullOrWhiteSpace(directory) && !Directory.Exists(directory))
            {
                Directory.CreateDirectory(directory);
            }

            var temporaryPath = path + ".tmp";
            var encoding = new UTF8Encoding(false);
            await File.WriteAllTextAsync(temporaryPath, json, encoding);

            try
            {
                if (File.Exists(path))
                {
                    File.Replace(temporaryPath, path, null);
                }
                else
                {
                    File.Move(temporaryPath, path);
                }
            }
            catch
            {
                if (File.Exists(path))
                {
                    File.Delete(path);
                }
                File.Move(temporaryPath, path);
            }
        }
    }
}

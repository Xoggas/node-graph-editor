using System;
using System.IO;
using Cysharp.Threading.Tasks;
using NodeGraph.Core;
using NodeGraph.Serialization;
using NodeGraph.UI;
using UnityEngine;

namespace NodeGraph.App
{
    public sealed class GraphEditorController
    {
        private readonly NodeGraphRegistry _registry;
        private readonly GraphViewModel _viewModel;
        private readonly IGraphFileDialog _fileDialog;
        private readonly GraphFileService _fileService;

        public GraphEditorController(NodeGraphRegistry registry, GraphViewModel viewModel, IGraphFileDialog fileDialog, GraphFileService fileService)
        {
            _registry = registry ?? throw new ArgumentNullException(nameof(registry));
            _viewModel = viewModel ?? throw new ArgumentNullException(nameof(viewModel));
            _fileDialog = fileDialog ?? throw new ArgumentNullException(nameof(fileDialog));
            _fileService = fileService ?? throw new ArgumentNullException(nameof(fileService));
        }

        public void NewGraph()
        {
            _viewModel.ReplaceGraph(new GraphModel(_registry));
            _viewModel.SetFilePath(string.Empty);
            _viewModel.SetStatus("New graph.");
        }

        public void AddNode(string typeId)
        {
            var zoom = Mathf.Max(_viewModel.Zoom.Value, 0.1f);
            var graphPosition = (new Vector2(160f, 100f) - _viewModel.ViewportPosition.Value) / zoom;
            try
            {
                _viewModel.CreateNode(typeId, graphPosition);
                _viewModel.SetStatus($"Added {typeId}.");
            }
            catch (Exception exception)
            {
                _viewModel.SetStatus(exception.Message);
            }
        }

        public async UniTask OpenAsync()
        {
            try
            {
                var path = await _fileDialog.OpenAsync();
                if (string.IsNullOrWhiteSpace(path))
                {
                    return;
                }

                var result = await _fileService.LoadAsync(path);
                _viewModel.ReplaceGraph(result.Graph);
                _viewModel.SetFilePath(path);
                _viewModel.SetStatus(result.Warnings.Count == 0
                    ? $"Opened: {Path.GetFileName(path)}"
                    : $"Opened with {result.Warnings.Count} warning(s).");
            }
            catch (Exception exception)
            {
                _viewModel.SetStatus($"Open failed: {exception.Message}");
            }
        }

        public async UniTask SaveAsync()
        {
            try
            {
                var path = _viewModel.CurrentFilePath.Value;
                if (string.IsNullOrWhiteSpace(path))
                {
                    path = await _fileDialog.SaveAsync(string.Empty);
                }
                if (string.IsNullOrWhiteSpace(path))
                {
                    return;
                }

                await _fileService.SaveAsync(_viewModel.Graph, path);
                _viewModel.MarkSaved(path);
            }
            catch (Exception exception)
            {
                _viewModel.SetStatus($"Save failed: {exception.Message}");
            }
        }
    }
}

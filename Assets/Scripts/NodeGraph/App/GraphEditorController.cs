using System;
using System.IO;
using Cysharp.Threading.Tasks;
using NodeGraph.Serialization;
using NodeGraph.UI;
using UnityEngine;

namespace NodeGraph.App
{
    public sealed class GraphEditorController
    {
        private readonly GraphViewModel _viewModel;
        private readonly GraphSession _session;
        private readonly IGraphFileDialog _fileDialog;
        private readonly GraphFileService _fileService;

        public GraphEditorController(GraphViewModel viewModel, GraphSession session, IGraphFileDialog fileDialog, GraphFileService fileService)
        {
            _viewModel = viewModel ?? throw new ArgumentNullException(nameof(viewModel));
            _session = session ?? throw new ArgumentNullException(nameof(session));
            _fileDialog = fileDialog ?? throw new ArgumentNullException(nameof(fileDialog));
            _fileService = fileService ?? throw new ArgumentNullException(nameof(fileService));
        }

        public void NewGraph()
        {
            _viewModel.RequestNewGraph();
        }

        public void AddNode(string typeId)
        {
            var zoom = Mathf.Max(_viewModel.Zoom.Value, 0.1f);
            var graphPosition = (new Vector2(160f, 100f) - _viewModel.ViewportPosition.Value) / zoom;
            AddNode(typeId, graphPosition);
        }

        public void AddNode(string typeId, Vector2 graphPosition)
        {
            _viewModel.RequestCreateNode(typeId, graphPosition);
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
                _viewModel.RequestReplaceGraph(
                    result.Graph,
                    path,
                    result.Warnings.Count == 0
                        ? $"Opened: {Path.GetFileName(path)}"
                        : $"Opened with {result.Warnings.Count} warning(s).");
            }
            catch (Exception exception)
            {
                _viewModel.RequestStatus($"Open failed: {exception.Message}");
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

                await _fileService.SaveAsync(_session.Graph, path);
                _viewModel.RequestSaveCompleted(path);
            }
            catch (Exception exception)
            {
                _viewModel.RequestStatus($"Save failed: {exception.Message}");
            }
        }
    }
}

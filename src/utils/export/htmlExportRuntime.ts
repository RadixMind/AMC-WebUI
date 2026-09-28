export const buildHtmlExportRuntime = (jsonCopiedText: string): string => `
            (function() {
                var backdrop = document.createElement('div');
                backdrop.className = 'amc-diagram-modal-backdrop';
                backdrop.innerHTML = '<div class="amc-diagram-modal-header">' +
                    '<div class="amc-diagram-modal-title">逻辑拓扑图 / Diagram Viewer</div>' +
                    '<div class="amc-diagram-modal-actions">' +
                        '<span class="amc-diagram-modal-hint">滚轮缩放 • 拖拽平移 • 双击重置</span>' +
                        '<span role="button" class="amc-diagram-btn" id="amc-zoom-in" title="放大 / Zoom In">+</span>' +
                        '<span role="button" class="amc-diagram-btn" id="amc-zoom-out" title="缩小 / Zoom Out">-</span>' +
                        '<span role="button" class="amc-diagram-btn" id="amc-zoom-reset" title="重置 / Reset">1:1</span>' +
                        '<span role="button" class="amc-diagram-btn" id="amc-zoom-fit" title="适应屏幕 / Fit">适应</span>' +
                        '<span role="button" class="amc-diagram-btn" id="amc-modal-close" title="关闭 / Close (Esc)">✕</span>' +
                    '</div>' +
                '</div>' +
                '<div class="amc-diagram-modal-viewport">' +
                    '<div class="amc-diagram-modal-canvas"></div>' +
                '</div>';
                document.body.appendChild(backdrop);

                var canvas = backdrop.querySelector('.amc-diagram-modal-canvas');
                var viewport = backdrop.querySelector('.amc-diagram-modal-viewport');
                var scale = 1;
                var translateX = 0;
                var translateY = 0;
                var isDragging = false;
                var startX = 0;
                var startY = 0;
                var initialSvgWidth = 0;
                var initialSvgHeight = 0;

                function updateTransform() {
                    canvas.style.transform = 'translate(' + translateX + 'px, ' + translateY + 'px) scale(' + scale + ')';
                }

                function fitToViewport() {
                    if (!initialSvgWidth || !initialSvgHeight) return;
                    var vpRect = viewport.getBoundingClientRect();
                    var padding = 40;
                    var availW = Math.max(100, vpRect.width - padding);
                    var availH = Math.max(100, vpRect.height - padding);
                    var sW = availW / initialSvgWidth;
                    var sH = availH / initialSvgHeight;
                    scale = Math.min(sW, sH, 2.5);
                    translateX = (vpRect.width - initialSvgWidth * scale) / 2;
                    translateY = (vpRect.height - initialSvgHeight * scale) / 2;
                    updateTransform();
                }

                function reset1to1() {
                    var vpRect = viewport.getBoundingClientRect();
                    scale = 1;
                    translateX = (vpRect.width - initialSvgWidth) / 2;
                    translateY = (vpRect.height - initialSvgHeight) / 2;
                    updateTransform();
                }

                function closeModal() {
                    backdrop.classList.remove('active');
                    canvas.innerHTML = '';
                }

                function openModal(svgEl) {
                    canvas.innerHTML = '';
                    var clone = svgEl.cloneNode(true);
                    clone.style.maxWidth = 'none';
                    clone.style.margin = '0';
                    clone.style.display = 'block';

                    var vb = clone.viewBox && clone.viewBox.baseVal;
                    if (vb && vb.width && vb.height) {
                        initialSvgWidth = vb.width;
                        initialSvgHeight = vb.height;
                    } else {
                        initialSvgWidth = parseFloat(clone.getAttribute('width')) || clone.clientWidth || 800;
                        initialSvgHeight = parseFloat(clone.getAttribute('height')) || clone.clientHeight || 600;
                    }
                    clone.setAttribute('width', initialSvgWidth + 'px');
                    clone.setAttribute('height', initialSvgHeight + 'px');
                    canvas.style.width = initialSvgWidth + 'px';
                    canvas.style.height = initialSvgHeight + 'px';
                    canvas.appendChild(clone);

                    backdrop.classList.add('active');
                    fitToViewport();
                }

                backdrop.querySelector('#amc-modal-close').addEventListener('click', closeModal);
                backdrop.querySelector('#amc-zoom-in').addEventListener('click', function(e) {
                    e.stopPropagation();
                    var vpRect = viewport.getBoundingClientRect();
                    var cx = vpRect.width / 2;
                    var cy = vpRect.height / 2;
                    var newScale = Math.min(scale * 1.3, 10);
                    translateX = cx - (cx - translateX) * (newScale / scale);
                    translateY = cy - (cy - translateY) * (newScale / scale);
                    scale = newScale;
                    updateTransform();
                });
                backdrop.querySelector('#amc-zoom-out').addEventListener('click', function(e) {
                    e.stopPropagation();
                    var vpRect = viewport.getBoundingClientRect();
                    var cx = vpRect.width / 2;
                    var cy = vpRect.height / 2;
                    var newScale = Math.max(scale / 1.3, 0.1);
                    translateX = cx - (cx - translateX) * (newScale / scale);
                    translateY = cy - (cy - translateY) * (newScale / scale);
                    scale = newScale;
                    updateTransform();
                });
                backdrop.querySelector('#amc-zoom-reset').addEventListener('click', function(e) {
                    e.stopPropagation();
                    reset1to1();
                });
                backdrop.querySelector('#amc-zoom-fit').addEventListener('click', function(e) {
                    e.stopPropagation();
                    fitToViewport();
                });

                viewport.addEventListener('wheel', function(e) {
                    e.preventDefault();
                    var delta = e.deltaY < 0 ? 1.15 : 0.87;
                    var newScale = Math.min(Math.max(scale * delta, 0.1), 15);
                    var rect = viewport.getBoundingClientRect();
                    var mouseX = e.clientX - rect.left;
                    var mouseY = e.clientY - rect.top;
                    translateX = mouseX - (mouseX - translateX) * (newScale / scale);
                    translateY = mouseY - (mouseY - translateY) * (newScale / scale);
                    scale = newScale;
                    updateTransform();
                }, { passive: false });

                viewport.addEventListener('mousedown', function(e) {
                    if (e.target.closest('.amc-diagram-btn')) return;
                    isDragging = true;
                    startX = e.clientX - translateX;
                    startY = e.clientY - translateY;
                });
                window.addEventListener('mousemove', function(e) {
                    if (!isDragging) return;
                    translateX = e.clientX - startX;
                    translateY = e.clientY - startY;
                    updateTransform();
                });
                window.addEventListener('mouseup', function() {
                    isDragging = false;
                });

                var touchStartDist = 0;
                var touchStartScale = 1;
                viewport.addEventListener('touchstart', function(e) {
                    if (e.touches.length === 1) {
                        isDragging = true;
                        startX = e.touches[0].clientX - translateX;
                        startY = e.touches[0].clientY - translateY;
                    } else if (e.touches.length === 2) {
                        isDragging = false;
                        var dx = e.touches[0].clientX - e.touches[1].clientX;
                        var dy = e.touches[0].clientY - e.touches[1].clientY;
                        touchStartDist = Math.sqrt(dx * dx + dy * dy);
                        touchStartScale = scale;
                    }
                }, { passive: true });
                viewport.addEventListener('touchmove', function(e) {
                    if (e.touches.length === 1 && isDragging) {
                        translateX = e.touches[0].clientX - startX;
                        translateY = e.touches[0].clientY - startY;
                        updateTransform();
                    } else if (e.touches.length === 2 && touchStartDist > 0) {
                        var dx = e.touches[0].clientX - e.touches[1].clientX;
                        var dy = e.touches[0].clientY - e.touches[1].clientY;
                        var dist = Math.sqrt(dx * dx + dy * dy);
                        var newScale = Math.min(Math.max(touchStartScale * (dist / touchStartDist), 0.1), 15);
                        scale = newScale;
                        updateTransform();
                    }
                }, { passive: true });
                viewport.addEventListener('touchend', function() {
                    isDragging = false;
                    touchStartDist = 0;
                });

                viewport.addEventListener('dblclick', function(e) {
                    if (e.target.closest('.amc-diagram-btn')) return;
                    if (Math.abs(scale - 1) < 0.1) {
                        fitToViewport();
                    } else {
                        reset1to1();
                    }
                });

                window.addEventListener('keydown', function(e) {
                    if (e.key === 'Escape' && backdrop.classList.contains('active')) {
                        closeModal();
                    }
                });

                document.addEventListener('click', function(e) {
                    var sel = window.getSelection();
                    if (sel && !sel.isCollapsed && sel.toString().trim().length > 0) return;
                    var target = e.target;
                    if (!(target instanceof Element)) return;
                    var container = target.closest('[data-amc-graphviz]');
                    if (!container) return;
                    if (target.closest('a, button, input, select, textarea')) return;
                    var svg = container.querySelector('svg');
                    if (!svg) return;
                    e.preventDefault();
                    e.stopPropagation();
                    openModal(svg);
                });
            })();

            (function() {
                var copyBtn = document.getElementById('amc-copy-btn');
                var copyText = document.getElementById('amc-copy-text');
                if (!copyBtn || !copyText) return;
                copyBtn.addEventListener('click', function() {
                    var content = document.querySelector('.exported-chat-content');
                    if (!content) return;
                    var text = content.innerText || content.textContent || '';
                    function onCopied() {
                        var orig = copyText.textContent;
                        copyText.textContent = ${jsonCopiedText};
                        copyBtn.classList.add('copied');
                        setTimeout(function() {
                            copyText.textContent = orig;
                            copyBtn.classList.remove('copied');
                        }, 1800);
                    }
                    if (navigator.clipboard && navigator.clipboard.writeText) {
                        navigator.clipboard.writeText(text).then(onCopied).catch(function(copyClipboardError) {
                            fallbackCopy(text, onCopied);
                        });
                    } else {
                        fallbackCopy(text, onCopied);
                    }
                });
                function fallbackCopy(text, cb) {
                    var ta = document.createElement('textarea');
                    ta.value = text;
                    ta.style.position = 'fixed';
                    ta.style.opacity = '0';
                    document.body.appendChild(ta);
                    ta.select();
                    try {
                        document.execCommand('copy');
                        cb();
                    } catch (execCopyError) {
                        // Ignored if execCommand fails in restricted permissions context
                    }
                    document.body.removeChild(ta);
                }
            })();
`;

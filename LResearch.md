# Technologies Employed in the Smart Parking Lot Detection System: A Research Overview

---

## Abstract

This report provides a comprehensive examination of the technologies underlying a real-time smart parking lot detection system. The system integrates modern web frameworks, deep learning model architectures, computer vision pipelines, and edge computing infrastructure to deliver automated parking space occupancy classification. The technologies reviewed span the full engineering stack: a React-based frontend, a FastAPI asynchronous backend, multiple convolutional neural network (CNN) architectures trained on the PKLot benchmark dataset, Ultralytics YOLO-based object detection, and an ExecuTorch-driven edge deployment pipeline targeting ARM64 hardware. Each technology is examined in terms of its theoretical foundation, its specific role within the system, and the engineering decisions that motivated its adoption.

---

## 1. Introduction

Automated parking management systems have emerged as a practical application of computer vision and machine learning in urban infrastructure. By classifying individual parking spaces as occupied or vacant in real time, such systems reduce vehicle search time, lower fuel consumption, and improve the utilisation efficiency of existing parking capacity (Amato et al., 2017). The system examined in this report realises these goals through a layered software architecture that connects a user-facing web dashboard to a machine learning inference engine, with support for deployment both on cloud servers and on constrained edge hardware such as the Raspberry Pi 5.

The system is designed around five core concerns: (1) real-time video ingestion and frame-level inference, (2) accurate binary classification of parking slot sub-images, (3) an interactive administrative interface for region-of-interest (ROI) definition and model training, (4) persistent storage of occupancy trends and alert events, and (5) portable model export for low-power edge devices. The technologies selected to address each concern are described in the sections that follow.

---

## 2. System Architecture Overview

The system follows a three-tier client–server architecture. The presentation layer is a single-page application (SPA) built with React 19 and bundled by Vite 8. The application layer is an asynchronous Python web service implemented with FastAPI and served by the Uvicorn ASGI server. The data layer consists of a SQLite 3 database operating in Write-Ahead Logging (WAL) mode and an on-disk model store containing serialised PyTorch checkpoints and exported edge runtimes.

Real-time video data flows from a connected source — a USB camera, an RTSP network stream, a YouTube HLS feed, or an uploaded video file — into a background VideoProcessor thread on the backend. Processed frames and occupancy metrics are forwarded to the frontend over WebSocket connections. REST endpoints handle configuration, training initiation, ROI management, and analytics retrieval. An optional edge deployment profile allows Raspberry Pi 5 nodes to run lightweight inference locally and synchronise occupancy records to a central hub server at a configurable interval.

---

## 3. Frontend Technologies

### 3.1 React 19

React is a declarative, component-based JavaScript library for building user interfaces (Meta Open Source, 2023). Version 19, adopted in this system, introduces enhanced support for concurrent rendering through the React Compiler and refined hook semantics. The system makes extensive use of functional components and the built-in `useState` and `useContext` hooks for local and shared state management, respectively. No additional state management library such as Redux is employed, consistent with the principle of avoiding unnecessary abstraction for a project of this scale.

The administrative interface exposes approximately twenty discrete components, including a canvas-based video feed renderer (`VideoFeed.jsx`), a polygon-drawing ROI editor (`RoiEditor.jsx`), a training progress panel (`TrainingPanel.jsx`), a multi-camera management view (`CameraManager.jsx`), and an anomaly detection toggle (`AnomalyPanel.jsx`). The public-facing view (`PublicView.jsx`) presents occupancy counts and availability percentages without exposing administrative controls.

### 3.2 Vite 8

Vite is a modern frontend build tool that leverages native ES module imports during development to achieve near-instantaneous hot module replacement (HMR), eliminating the full-bundle rebuild cycle characteristic of earlier tools such as Webpack (Vite, 2024). In production, Vite compiles the application into optimised static bundles using Rollup. The system's choice of Vite over Create React App reflects the preference for faster iteration cycles during training-pipeline development, where frontend changes must be validated quickly alongside concurrent backend experiments.

### 3.3 WebSocket and the Canvas API

Real-time occupancy visualisation is achieved through the browser WebSocket API, which provides a persistent, full-duplex communication channel between the frontend and the FastAPI backend. The backend streams binary JPEG frames alongside JSON metrics payloads at up to 20 frames per second. The `VideoFeed` component renders these frames onto an HTML5 `<canvas>` element, overlaying ROI polygon boundaries and per-slot status indicators directly onto the decoded image data. This approach avoids the latency overhead of HTTP polling and the complexity of media streaming protocols such as HLS for short-latency occupancy feedback.

### 3.4 React Router DOM 7

Client-side routing between the public dashboard and the PIN-protected administrative panel is managed by React Router DOM version 7. The PIN authentication mechanism stores the session token in `sessionStorage`, which is intentionally cleared when the browser tab is closed, providing lightweight access control appropriate for an administrative interface that resides within a secured network perimeter.

---

## 4. Backend Technologies

### 4.1 FastAPI

FastAPI is a modern, high-performance Python web framework for building APIs, built on top of Starlette and Pydantic (Ramírez, 2019). It is designed around Python's native `async`/`await` syntax and the ASGI (Asynchronous Server Gateway Interface) specification, enabling non-blocking I/O for concurrent request handling. This is particularly significant for a computer vision backend, where frame processing, database writes, and WebSocket broadcasts must proceed simultaneously without blocking the event loop.

FastAPI generates OpenAPI documentation automatically from type-annotated function signatures, improving maintainability. The system exposes endpoints across several functional groups: inference (`/api/predict`, `/api/metrics`), video source management (`/api/use-camera`, `/api/upload-video`), training lifecycle (`/api/train/start`, `/api/train/status`), ROI persistence (`/api/roi`), multi-camera registry (`/api/cameras`), analytics retrieval (`/api/trends`, `/api/alerts`), and edge data ingestion (`/api/ingest/occupancy`, `/api/ingest/alerts`).

### 4.2 Uvicorn

Uvicorn is a lightning-fast ASGI server implementation built on `uvloop` and `httptools` (Encode, 2024). It serves as the process-level HTTP and WebSocket server for the FastAPI application, handling connection lifecycle, protocol negotiation, and I/O multiplexing. Its support for WebSocket upgrades is essential for the real-time streaming architecture described in Section 3.3.

### 4.3 SlowAPI

Rate limiting is enforced through SlowAPI, a FastAPI-compatible wrapper around the `limits` library. The system applies a ceiling of three training requests per hour to the `/api/train/start` endpoint, preventing computational resource exhaustion from repeated or malicious training triggers. This constitutes a practical denial-of-service mitigation measure appropriate for a production-facing service.

### 4.4 SQLite 3 with WAL Mode

Occupancy records, alert events, and training run metadata are persisted in a SQLite 3 database. WAL (Write-Ahead Logging) mode is enabled to permit concurrent readers during write operations, which is essential in a system where a background VideoProcessor thread writes occupancy snapshots every sixty seconds while REST API handlers read historical records for analytics queries. Three tables constitute the schema: `occupancy_history` (per-camera timestamped snapshots), `alert_events` (threshold-triggered notifications at 70%, 85%, and 95% occupancy), and `training_runs` (training lifecycle records including accuracy and duration). An additional `synced` flag on occupancy and alert records supports the edge-to-hub synchronisation workflow described in Section 8.

---

## 5. Machine Learning Frameworks

### 5.1 PyTorch

PyTorch is an open-source deep learning framework developed by Meta AI Research, characterised by its dynamic computational graph (define-by-run execution) and its first-class support for GPU acceleration via CUDA (Paszke et al., 2019). The system targets PyTorch 2.0 and above, which introduced `torch.compile`, improved TorchScript tracing, and the ExecuTorch export pipeline. All three custom CNN architectures — the scratch-built CNN, the ResNet50 transfer learning variant, and the MobileNetV4 variant — are implemented as `torch.nn.Module` subclasses, enabling a unified training loop across all model families.

PyTorch's `DataLoader` class manages batched data loading with configurable parallelism (`num_workers=2–4`), shuffling, and augmentation. The system uses `BCEWithLogitsLoss` (binary cross-entropy with integrated sigmoid) as the loss function for all binary classifiers, which is numerically more stable than applying a sigmoid activation followed by `BCELoss`.

### 5.2 TorchVision

TorchVision provides pretrained model weights, standard image transformations, and dataset utilities tightly integrated with PyTorch (Marcel & Rodriguez, 2010). The system uses TorchVision for two purposes: loading the pretrained ResNet50 backbone (`torchvision.models.resnet50(weights=ResNet50_Weights.IMAGENET1K_V1)`) and applying the `transforms` pipeline for image preprocessing. The standard ImageNet normalisation statistics (mean `[0.485, 0.456, 0.406]`, standard deviation `[0.229, 0.224, 0.225]`) are applied at inference time to match the distribution on which all pretrained backbones were trained.

### 5.3 timm (PyTorch Image Models)

The `timm` library, maintained by Ross Wightman, provides a curated collection of state-of-the-art image classification architectures and pretrained weights (Wightman, 2019). The system uses `timm` specifically to access the MobileNetV4 family, which was not yet available in the official TorchVision release at the time of development. The exact variant `mobilenetv4_conv_small.e2400_r224_in1k` is pinned by name to prevent unintended weight changes from future `timm` updates, a common source of non-reproducibility in transfer learning workflows.

### 5.4 Ultralytics (YOLO26)

The Ultralytics library provides a high-level Python API for training and deploying YOLO (You Only Look Once) family models (Jocher et al., 2023). The system integrates two distinct YOLO26 models: a classification model (`best_yolo26_classify.pt`) that performs binary occupied/vacant prediction on pre-cropped slot sub-images at 64×64 resolution, and a detection model (`best_yolo26_detect.pt`) that localises vehicles within the full parking lot frame for anomaly detection. YOLO26 is an NMS-free, edge-optimised architecture released in January 2026, offering improved inference speed on constrained hardware compared to earlier YOLO generations.

---

## 6. Model Architectures

### 6.1 Custom CNN with Squeeze-and-Excitation Attention (ParkingCNN)

The scratch-built CNN constitutes the baseline model of the system and is trained entirely on the PKLot dataset without reusing pretrained weights. The architecture consists of six convolutional blocks arranged in a sequential feature extraction hierarchy. Each block applies two successive `Conv2d → BatchNorm2d → ReLU` operations followed by `MaxPool2d(2,2)` strided downsampling. The channel progression across blocks is 3 → 32 → 64 → 128 → 256 → 512 → 512, while the spatial resolution decreases from 224×224 to approximately 3×3 pixels at the deepest layer.

A Squeeze-and-Excitation (SE) block (Hu et al., 2018) is applied after the final convolutional stage. The SE mechanism performs global average pooling to compress spatial dimensions into a channel descriptor vector, passes it through two fully connected layers with a bottleneck ratio of 16, applies a sigmoid gate, and re-scales the feature maps channel-wise. This recalibration suppresses uninformative channels and amplifies discriminative ones, which is particularly beneficial when occupancy cues vary in their spatial distribution across different lighting conditions.

The classification head reduces the 512-dimensional feature vector through two fully connected layers with batch normalisation and dropout regularisation (rates of 0.4 and 0.2), terminating in a single linear output logit. The model contains approximately 1.5 million trainable parameters, making it suitable for environments where model weight transfer is constrained.

### 6.2 ResNet50 Transfer Learning (ParkingResNet)

ResNet50 is a 50-layer residual network originally proposed by He et al. (2016) that introduced skip (shortcut) connections to address the vanishing gradient problem in very deep networks. The skip connections enable gradients to flow directly from later layers to earlier ones during backpropagation, allowing networks of unprecedented depth to be trained reliably.

In the parking detection context, the pretrained ResNet50 backbone (11.6 million parameters) is frozen entirely, and only a custom classification head is trained. The head replaces the original 1,000-class ImageNet linear layer with a two-stage reduction: `FC(2048→512) → ReLU → Dropout(0.3) → FC(512→1)`. This configuration yields approximately 131,000 trainable parameters — roughly 1% of the total parameter count — enabling rapid convergence from a small labelled dataset. An optional `unfreeze_layers(num_layers=3)` method supports progressive fine-tuning of the final backbone layers in a subsequent training phase.

### 6.3 MobileNetV4 Small Transfer Learning (ParkingMobileNetV4)

MobileNetV4 is an architecture from Google's MobileNet series, designed for efficient inference on mobile and embedded processors (Howard et al., 2017; updated 2024). The `mobilenetv4_conv_small` variant employs depthwise separable convolutions, which factorise a standard convolution into a depthwise spatial convolution and a pointwise channel-mixing convolution, reducing the computational cost by a factor proportional to the number of output channels.

The system loads this backbone in evaluation mode and keeps it frozen throughout training to prevent batch normalisation running statistics from being corrupted at the 1×1 spatial resolution that arises with small input crops. The head follows the same pattern as ResNet50: global average pooling followed by `FC(num_features→256) → ReLU → Dropout(0.3) → FC(256→1)`. With approximately 328,000 trainable parameters and a total footprint of 3.5 million parameters, MobileNetV4 Small is the primary candidate for edge deployment on the Raspberry Pi 5.

### 6.4 YOLO26 Object Detection for Anomaly Analysis

Beyond slot-level classification, the system employs the YOLO26 detection model to identify improperly parked vehicles — specifically those positioned outside their designated ROI markings or straddling the boundary between two slots. This anomaly detection capability operates on the full parking lot frame rather than pre-cropped regions, enabling spatial reasoning that slot-level classifiers cannot perform. Vehicle detections are filtered to class index 1 (occupied proxy), with a confidence threshold of 0.1 and an IoU threshold of 0.7 for non-maxima suppression, thresholds empirically tuned to accommodate the lower detection confidence characteristic of overhead parking lot imagery.

---

## 7. Computer Vision Pipeline

### 7.1 OpenCV

OpenCV (Open Source Computer Vision Library) is a foundational library for real-time image and video processing (Bradski, 2000). The system uses OpenCV 4.9.0 for frame capture from USB cameras and RTSP streams (`cv2.VideoCapture`), frame resizing (`cv2.resize`), colour space conversion (BGR to RGB for PyTorch compatibility), and polygon-based region cropping. OpenCV's multi-threaded capture backend allows the VideoProcessor to read frames on a dedicated thread, decoupled from the inference thread, preventing frame starvation under variable processing latency.

### 7.2 Region-of-Interest Based Detection

Rather than running a global object detector on the entire image, the system adopts an ROI-based approach: a human operator defines polygonal regions corresponding to individual parking spaces using the interactive canvas editor in the administrative frontend. At inference time, the SlotDetector crops each polygon's bounding rectangle from the current frame and passes it to the ParkingClassifier. This design trades the flexibility of a fully automatic detector for predictable, interpretable inference: each slot's prediction is independent, the classification is performed on a spatially constrained input, and false positives from background regions are structurally excluded.

ROI definitions are stored as JSON files in a per-camera directory, loaded on application start, and served via the `/api/roi` REST endpoint. The RoiEditor frontend component supports creating, editing (vertex drag, edge drag, vertex insertion), duplicating, and scaling polygon definitions, enabling rapid reconfiguration when cameras are repositioned.

### 7.3 Inference Confidence Thresholding

A confidence threshold of 0.6 is applied at inference time across all model variants. Predictions where the sigmoid-transformed logit falls between 0.4 and 0.6 — a range indicating model uncertainty near the decision boundary — are returned as `"unknown"` rather than forced into a binary label. This prevents marginal predictions from contributing to occupancy statistics as false positives or false negatives, which is particularly important in lighting transition periods such as dawn and dusk when parking lot appearance changes rapidly.

---

## 8. Data Augmentation and the Shadow Drift Problem

### 8.1 Standard Augmentation

The training data pipeline applies several standard augmentation operations to images in the training split, while the validation and test splits receive only deterministic preprocessing. Standard augmentations include `RandomHorizontalFlip(p=0.5)` and `ColorJitter(brightness=0.3, contrast=0.3, saturation=0.3)`, which increase the apparent diversity of the training distribution and reduce overfitting to specific lighting conditions and camera orientations.

### 8.2 Shadow Drift Mitigation via RandomShadow Augmentation

A domain-specific augmentation, `_RandomShadow`, was developed to address a failure mode observed during system evaluation: models trained on daytime imagery systematically misclassify vacant parking spaces as occupied when a shadow boundary falls across the space. This effect, termed shadow drift, arises because shadow patterns partially replicate the visual texture of vehicle interiors or tyres on asphalt.

The `_RandomShadow` transform synthesises a partial shade band across the training image. A horizontal stripe occupying 20% to 60% of the image width is darkened to between 35% and 65% of its original brightness, applied with a probability of 0.5. This forces the model to develop occupancy-discriminating features that are invariant to localised brightness discontinuities, rather than relying on the presence of high-contrast regions as a proxy for vehicle presence. The augmentation is implemented as a custom torchvision-compatible transform and is applied only during training.

---

## 9. Training Procedure

All CNN-family models share a common training procedure implemented in the `Trainer` class. The loss function is `BCEWithLogitsLoss`, which combines a sigmoid activation with binary cross-entropy in a single numerically stable operation. Optimisation is performed by Adam (Kingma & Ba, 2015), an adaptive gradient method with default momentum parameters (`β₁=0.9`, `β₂=0.999`) and a weight decay of `1×10⁻⁴` for L2 regularisation. The initial learning rate is `1×10⁻³`.

Learning rate scheduling is applied via `ReduceLROnPlateau`, which reduces the learning rate by a factor of 0.1 when validation loss fails to improve for two consecutive epochs. An early stopping mechanism with patience of four epochs halts training when no improvement in validation loss is observed, preventing overfitting and reducing unnecessary computation. The best model checkpoint — measured by validation accuracy — is saved to disk and subsequently used for inference and export. Training runs are logged to the `training_runs` database table with start time, finish time, epoch count, final accuracy, and dataset size.

---

## 10. Edge Deployment Technologies

### 10.1 ExecuTorch

ExecuTorch is PyTorch's official framework for on-device inference, introduced in PyTorch 2.x, targeting embedded and mobile processors with the XNNPACK accelerated neural network library (Meta AI, 2024). After a successful training run, the system automatically exports the trained model to ExecuTorch's `.pte` (portable tensor engine) format using the XNNPACK delegate, which leverages ARM NEON SIMD instructions on the Raspberry Pi 5's Cortex-A76 cores. This enables the neural network to execute significantly faster than a naive Python interpreter loop would permit, approaching the throughput achievable in native C++ deployments.

### 10.2 ONNX Runtime Fallback

In environments where the ExecuTorch runtime is unavailable — for example, on Raspberry Pi OS variants without the required native libraries — the system falls back to ONNX (Open Neural Network Exchange) format. ONNX is a vendor-neutral intermediate representation for neural networks supported by a wide ecosystem of runtimes (ONNX, 2019). The `onnxruntime` library performs the inference using optimised CPU kernels, providing a portable fallback that requires no recompilation and supports deployment on x86-64 servers and ARM64 edge devices alike.

### 10.3 Edge Deployment Profile

The system supports two deployment profiles, configured via the `SMARTPARK_DEPLOYMENT` environment variable. In the `edge` profile, the backend operates with reduced resolution (640×480), a lower frame rate (6 FPS), and the ExecuTorch classifier in place of the full PyTorch model. A background `SyncWorker` thread pushes unsynced occupancy and alert records to a central hub server every sixty seconds. Records include a `synced` flag that transitions from 0 to 1 upon successful transmission, providing at-least-once delivery semantics with local buffering to tolerate network interruptions.

---

## 11. Security Architecture

### 11.1 API Key Authentication

Administrative and ingest endpoints are protected by an API key transmitted in the `X-API-Key` HTTP header. Key comparison is performed using HMAC-based constant-time comparison (`hmac.compare_digest`) to prevent timing side-channel attacks, wherein an attacker could infer the correct key by measuring response latency differences arising from short-circuit string comparison.

### 11.2 Input Validation and Injection Mitigation

Camera identifiers used to construct ROI file paths are validated against an allowlist regular expression before file system access, preventing path traversal attacks. Uploaded video filenames are reduced to their basename component (`os.path.basename`) before storage, stripping any directory traversal sequences. Upload sizes are bounded at 20 MB for images and 500 MB for video files. External camera source URLs (RTSP streams, YouTube links) are validated against expected scheme patterns in a dedicated `_validate_camera_source` function, mitigating server-side request forgery (SSRF) attacks.

### 11.3 Rate Limiting

The training initiation endpoint is rate-limited to three requests per hour per client IP address using SlowAPI. This prevents computational denial-of-service through repeated training triggers, which would exhaust GPU or CPU resources on the host.

---

## 12. Dataset

The system is trained and evaluated on the PKLot dataset, a publicly available benchmark comprising images captured from surveillance cameras mounted above parking lots at the Federal University of Paraná, Brazil (De Almeida et al., 2015). The dataset contains over 12,000 labelled images of individual parking spaces under varied weather conditions (sunny, overcast, and rainy) and at different times of day. Images are pre-cropped to individual slot regions and labelled as `occupied` or `vacant`. The system partitions the dataset into training (70%), validation (15%), and test (15%) subsets using a fixed random seed for reproducibility. A configurable subset size (default 12,000 samples) supports rapid experimentation without processing the full dataset on each training run.

---

## 13. Comparative Summary of Model Architectures

| Architecture | Total Parameters | Trainable Parameters | Expected Accuracy | Primary Deployment Target |
|---|---|---|---|---|
| CNN Scratch (ParkingCNN) | ~1.5M | ~1.5M | ~94% | Server or edge (moderate) |
| ResNet50 (ParkingResNet) | ~11.7M | ~131K | ~97% | Server |
| MobileNetV4 Small | ~3.5M | ~328K | ~96% | Edge (Raspberry Pi 5) |
| YOLO26 Classify | <5M (Ultralytics) | N/A (pretrained) | N/A (not benchmarked) | Server and edge |
| YOLO26 Detect | <5M (Ultralytics) | N/A (pretrained) | N/A (anomaly use) | Server |

---

## 14. Conclusion

The smart parking lot detection system described in this report demonstrates the practical integration of a broad range of modern software and machine learning technologies. React 19 and Vite 8 provide a responsive, low-latency frontend capable of rendering real-time video overlays and administrative controls. FastAPI and Uvicorn deliver an asynchronous Python backend capable of handling concurrent WebSocket streams and REST requests without blocking. PyTorch, TorchVision, and timm underpin a flexible model training framework supporting architectures ranging from a purpose-built CNN with attention mechanisms to state-of-the-art transfer learning backbones. The Ultralytics YOLO26 integration extends the system's capabilities to full-frame vehicle detection for anomaly classification. OpenCV manages the video capture and frame processing pipeline that feeds real-time data to the inference engine. Finally, ExecuTorch and ONNX Runtime enable the system to extend its reach from cloud servers to ARM64 edge hardware, closing the loop between centralised training and distributed inference.

Taken together, these technologies constitute a coherent, production-oriented stack in which each component was selected for its specific performance characteristics, ecosystem maturity, and compatibility with the operational constraints of real-time embedded computer vision.

---

## References

- Amato, G., Carrara, F., Falchi, F., Gennaro, C., Meghini, C., & Salvatori, C. (2017). Deep learning for decentralized parking lot occupancy detection. *Expert Systems with Applications*, 72, 327–334.
- Bradski, G. (2000). The OpenCV Library. *Dr. Dobb's Journal of Software Tools*.
- De Almeida, P. R. L., Oliveira, L. S., Britto, A. S., Silva, E. J., & Koerich, A. L. (2015). PKLot – A robust dataset for parking lot classification. *Expert Systems with Applications*, 42(11), 4937–4949.
- Encode. (2024). *Uvicorn: An ASGI web server implementation for Python*. https://www.uvicorn.org
- He, K., Zhang, X., Ren, S., & Sun, J. (2016). Deep residual learning for image recognition. *Proceedings of the IEEE Conference on Computer Vision and Pattern Recognition (CVPR)*, 770–778.
- Howard, A. G., Zhu, M., Chen, B., Kalenichenko, D., Wang, W., Weyand, T., Andreetto, M., & Adam, H. (2017). MobileNets: Efficient convolutional neural networks for mobile vision applications. *arXiv preprint arXiv:1704.04861*.
- Hu, J., Shen, L., & Sun, G. (2018). Squeeze-and-excitation networks. *Proceedings of the IEEE Conference on Computer Vision and Pattern Recognition (CVPR)*, 7132–7141.
- Jocher, G., Chaurasia, A., & Qiu, J. (2023). *Ultralytics YOLO*. https://github.com/ultralytics/ultralytics
- Kingma, D. P., & Ba, J. (2015). Adam: A method for stochastic optimization. *Proceedings of the International Conference on Learning Representations (ICLR)*.
- Marcel, S., & Rodriguez, Y. (2010). Torchvision the machine-vision package of torch. *Proceedings of the 18th ACM International Conference on Multimedia*, 1485–1488.
- Meta AI. (2024). *ExecuTorch: On-device AI across mobile, embedded and edge for PyTorch*. https://pytorch.org/executorch
- ONNX. (2019). *Open Neural Network Exchange*. https://onnx.ai
- Paszke, A., Gross, S., Massa, F., Lerer, A., Bradbury, J., Chanan, G., ... & Chintala, S. (2019). PyTorch: An imperative style, high-performance deep learning library. *Advances in Neural Information Processing Systems*, 32.
- Ramírez, S. (2019). *FastAPI*. https://fastapi.tiangolo.com
- Vite. (2024). *Vite — Next Generation Frontend Tooling*. https://vitejs.dev
- Wightman, R. (2019). *PyTorch Image Models (timm)*. https://github.com/huggingface/pytorch-image-models

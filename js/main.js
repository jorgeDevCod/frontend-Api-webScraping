// Configuración
const API_URL = '/api';
const BATCH_SIZE = 250;
const MAX_URLS = 300;
const RATE_LIMIT_DELAY = 1000;
const MAX_RETRIES = 4;
const REQUEST_TIMEOUT = 150000;
const NOTIFICATION_DURATION = 5000;
const PROGRESS_UPDATE_INTERVAL = 100;
const ITEMS_PER_PAGE_OPTIONS = [ 10, 30, 50, 100 ];
const ANIMATION_INTERVAL = 50;
const STEP_INCREMENT = 0.5;
let progressInterval;

// Variables
let isCancelled = false;
let currentPage = 1;
let itemsPerPage = 30;
let selectedRows = new Set();
let allResults = [];
const elements = {};

// Inicialización
document.addEventListener( 'DOMContentLoaded', () => {

    // Cache de elementos DOM
    const elementIds = [
        'urls', 'scrapeButton', 'errorMessage', 'result-body', 'url-counter',
        'progress-status', 'copyButton', 'processing-overlay', 'status-slide',
        'current-url', 'total-urls', 'processing-message', 'result-table',
        'clear-urls', 'clear-results', 'results-counter', 'cancelButton',
        'progress-bar', 'progress-percentage', 'loader-text', 'page-size'
    ];
    elementIds.forEach( id => elements[ id ] = document.getElementById( id ) );


    // Event listeners
    const urlsTextarea = document.getElementById( 'urls' );
    const clearUrlsButton = document.getElementById( 'clearUrls' );
    const clearResultsButton = document.getElementById( 'clearResults' );
    const scrapeButton = document.getElementById( 'scrapeButton' );
    const copyButton = document.querySelector( '.copy-button' );

    // Añadir event listeners
    if ( urlsTextarea ) urlsTextarea.addEventListener( 'input', updateUrlCounter );
    if ( clearUrlsButton ) clearUrlsButton.addEventListener( 'click', clearUrls );
    if ( clearResultsButton ) clearResultsButton.addEventListener( 'click', clearResults );
    if ( scrapeButton ) scrapeButton.addEventListener( 'click', scrapeMetaTags );
    if ( copyButton ) copyButton.addEventListener( 'click', copyTable );


    const pageSizeSelect = document.getElementById( 'page-size' );
    if ( pageSizeSelect ) {
        pageSizeSelect.addEventListener( 'change', handlePageSizeChange );
    }

    // Inicializar contador de URLs
    updateUrlCounter();

    // Cargar librería SheetJS
    loadSheetJS();
} );

// Funciones auxiliares
// Crea una promesa que se resuelve después de un tiempo determinado.
const delay = ms => new Promise( resolve => setTimeout( resolve, ms ) );

// Verifica si una URL es válida.
const isValidUrl = url => { try { new URL( url ); return true; } catch { return false; } };

// Divide el array en lotes más pequeños.
const splitIntoBatches = urls => {
    const batches = [];
    for ( let i = 0; i < urls.length; i += BATCH_SIZE ) {
        batches.push( urls.slice( i, i + BATCH_SIZE ) );
    }
    return batches;
};


// Funciones principales
// Actualiza el contador de elementos seleccionados
function updateSelectedCount() {
    const selectedCountElement = document.getElementById( 'selected-count' );
    const count = selectedRows.size;

    if ( selectedCountElement ) {
        selectedCountElement.textContent = `${count} ${count === 1 ? 'elemento seleccionado' : 'elementos seleccionados'}`;
        selectedCountElement.className = 'selected-count ' +
            ( count > 0 ? 'text-blue-600 font-semibold animate-fade-in' : 'text-gray-500' );
    }

    // Actualizar el estado del checkbox en el header
    const headerCheckbox = document.querySelector( '#result-table thead input[type="checkbox"]' );
    if ( headerCheckbox ) {
        const allCheckboxes = document.querySelectorAll( '#result-table tbody input[type="checkbox"]' );
        headerCheckbox.checked = count > 0 && count === allCheckboxes.length;
        headerCheckbox.indeterminate = count > 0 && count < allCheckboxes.length;
    }

    // Actualizar texto del botón de limpiar
    const clearButton = document.getElementById( 'clearResults' );
    if ( clearButton ) {
        clearButton.textContent = count > 0 ? 'Eliminar Seleccionados 🗑️' : 'Limpiar Resultados 🗑️';
    }
}

// Actualiza el contador de elementos seleccionados
function clearUrls() {
    elements.urls.value = '';
    updateUrlCounter();
    elements.urls.classList.add( 'fade-in' );
    setTimeout( () => elements.urls.classList.remove( 'fade-in' ), 300 );
}

// Limpia la tabla de resultados
function clearResults() {
    const fadeOutDuration = 300;

    if ( selectedRows.size > 0 ) {
        const selectedElements = document.querySelectorAll( 'tr.selected' );
        selectedElements.forEach( row => {
            row.style.transition = `opacity ${fadeOutDuration}ms ease-out`;
            row.style.opacity = '0';
        } );

        setTimeout( () => {
            allResults = allResults.filter( result => !selectedRows.has( result.url ) );
            selectedRows.clear();
            updateResultsCounter();
            displayResults( allResults );
            updateSelectedCount();
            updatePaginationControls( Math.ceil( allResults.length / itemsPerPage ) );
        }, fadeOutDuration );
    } else {
        elements[ 'result-body' ].style.transition = `opacity ${fadeOutDuration}ms ease-out`;
        elements[ 'result-body' ].style.opacity = '0';

        setTimeout( () => {
            allResults = [];
            updateResultsCounter();
            displayResults( allResults );
            updatePaginationControls( 0 ); // Ocultar paginación
            elements[ 'result-body' ].style.opacity = '1';
        }, fadeOutDuration );
    }
}

// Actualiza el contador de resultados.
function updateResultsCounter() {
    elements[ 'results-counter' ].textContent = `(${allResults.length} resultados)`;
}

// Actualiza el contador de URLs ingresadas.
function updateUrlCounter() {
    const urls = elements.urls.value.trim().split( '\n' ).filter( url => url.trim() );
    const count = urls.length;
    elements[ 'url-counter' ].textContent = `URLs ingresadas: ${count}`;
    elements[ 'url-counter' ].classList.toggle( 'no-urls', count === 0 );
    elements[ 'url-counter' ].classList.add( 'fade-in' );
    setTimeout( () => elements[ 'url-counter' ].classList.remove( 'fade-in' ), 300 );
}

// Detener el proceso de scraping.
function setupCancelButton() {
    const cancelButton = document.getElementById( 'cancelButton' );
    if ( cancelButton ) {
        cancelButton.addEventListener( 'click', async () => {
            isCancelled = true;
            window.isProcessing = false;

            // Actualizar UI
            updateStatusMessage( 'Cancelando el proceso...' );
            await delay( 1000 );
            toggleLoader( false );

            // Limpiar estado
            clearProgressAnimation();
            showNotification( 'Proceso cancelado por el usuario', 'info' );
        } );
    }
}

// Valida y prepara las URLs ingresadas
function validateAndPrepareUrls( input ) {
    return input.split( '\n' ).map( url => url.trim() ).filter( isValidUrl );
}

// Muestra u oculta el loader.
function toggleLoader( show, data = {} ) {
    const loaderContainer = document.getElementById( 'loader-container' );
    if ( !loaderContainer ) return;

    if ( show ) {
        loaderContainer.style.display = 'flex';
        if ( data.processedUrls !== undefined && data.totalUrls !== undefined ) {
            updateLoaderProgress(
                data.processedUrls,
                data.totalUrls,
                data.status || 'Preparando análisis...'
            );
        }
    } else {
        clearProgressAnimation();
        loaderContainer.style.display = 'none';
    }
}

// Maneja el cambio de tamaño de página
function handlePageSizeChange( e ) {
    itemsPerPage = parseInt( e.target.value );
    currentPage = 1;
    displayResults( allResults );
}

function getStatusMessage( percentage ) {
    if ( percentage === 100 ) return 'Meta datos extraídos con éxito';
    if ( percentage === 0 ) return 'Iniciando análisis...';
    if ( percentage < 33 ) return 'Analizando URLs...';
    if ( percentage < 66 ) return 'Obteniendo meta datos...';
    return 'Procesando resultados...';
}

// Obtiene el mensaje de estado para el loader
function updateLoaderProgress( current, total, status = '' ) {
    const percentage = Math.floor( ( current / total ) * 100 );

    // Actualizar barra de progreso
    const progressBar = document.getElementById( 'progress-bar' );
    if ( progressBar ) {
        progressBar.style.width = `${percentage}%`;
    }

    // Actualizar porcentaje numérico
    const progressPercentage = document.getElementById( 'progress-percentage' );
    if ( progressPercentage ) {
        progressPercentage.textContent = percentage;
    }

    // Actualizar contador de URLs
    const progressStatus = document.getElementById( 'progress-status' );
    if ( progressStatus ) {
        progressStatus.textContent = `${current}/${total}`;
    }

    // Actualizar mensaje de estado
    const loaderText = document.getElementById( 'loader-text' );
    if ( loaderText ) {
        const message = getStatusMessage( percentage );
        loaderText.textContent = status || message;
    }

    // Actualizar los pasos numerados
    updateProgressSteps( percentage );
}

// Función para actualizar el progreso del loader.
function updateProgressSteps( percentage ) {
    const steps = document.querySelectorAll( '.step' );
    steps.forEach( ( step, index ) => {
        const stepThreshold = ( index + 1 ) * ( 100 / steps.length );
        const shouldBeActive = percentage >= stepThreshold;

        if ( shouldBeActive !== step.classList.contains( 'active' ) ) {
            step.classList.toggle( 'active', shouldBeActive );

            // Añadir animación de transición
            step.style.transition = 'all 0.3s ease-in-out';
        }
    } );
}

// Muestra  mensaje de error.
function showError( message ) {
    elements.errorMessage.textContent = message;
    elements.errorMessage.style.display = 'block';
    setTimeout( () => elements.errorMessage.style.display = 'none', 5000 );
}

// Muestra notificaciónes.
function showNotification( message, type ) {
    const notification = document.createElement( 'div' );
    notification.className = `notification ${type}`;
    notification.textContent = message;
    document.body.appendChild( notification );
    setTimeout( () => notification.remove(), NOTIFICATION_DURATION );
}

// Actualiza el mensaje de  loader
function updateStatusMessage( message, duration = 2000 ) {
    elements[ 'loader-text' ].style.opacity = '0';
    setTimeout( () => {
        elements[ 'loader-text' ].textContent = message;
        elements[ 'loader-text' ].style.opacity = '1';
    }, 200 );

    if ( duration > 0 ) {
        setTimeout( () => {
            elements[ 'loader-text' ].style.opacity = '0';
            setTimeout( () => {
                elements[ 'loader-text' ].textContent = 'Procesando...';
                elements[ 'loader-text' ].style.opacity = '1';
            }, 200 );
        }, duration );
    }
}

// Procesa lote de URLs con reintentos por error.
async function processBatchWithRetry( currentBatch, retries = MAX_RETRIES ) {
    let lastError = null;
    for ( let attempt = 1; attempt <= retries; attempt++ ) {
        try {
            updateStatusMessage( `Intento ${attempt} de ${retries} para el lote actual` );
            const controller = new AbortController();
            const signal = controller.signal;
            const timeoutId = setTimeout( () => controller.abort(), REQUEST_TIMEOUT );

            const response = await fetch( `${API_URL}/scrape`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Requested-With': 'XMLHttpRequest'
                },
                body: JSON.stringify( { urls: currentBatch } ),
                credentials: 'same-origin',
                signal: signal
            } );

            clearTimeout( timeoutId );

            if ( !response.ok ) {
                throw new Error( `Error HTTP: ${response.status}` );
            }

            const data = await response.json();
            return data.map( result => {
                if ( !result.metaTags || Object.keys( result.metaTags ).length === 0 ) {
                    return {
                        url: result.url,
                        metaTags: [
                            { name: 'title', content: 'No encontrado' },
                            { name: 'description', content: 'No encontrado' },
                            { name: 'canonical', content: 'No encontrado' },
                            { name: 'h1', content: 'No encontrado' },
                            { name: 'og:title', content: 'No encontrado' },
                            { name: 'og:description', content: 'No encontrado' },
                            { name: 'og:url', content: 'No encontrado' }
                        ],
                        status: 'no_data'
                    };
                }
                return result;
            } );
        } catch ( error ) {
            lastError = error;
            console.error( `Intento ${attempt} fallido:`, error );
            if ( attempt < retries ) {
                await delay( RATE_LIMIT_DELAY * attempt );
            }
        }
    }
    throw new Error( `Todos los intentos fallaron. Último error: ${lastError.message}` );
}

// Función principal para scraping 
async function scrapeMetaTags() {
    if ( window.isProcessing ) return;
    window.isProcessing = true;
    isCancelled = false;

    try {
        const urls = validateAndPrepareUrls( elements.urls.value.trim() );
        const totalUrls = urls.length;

        if ( totalUrls === 0 ) {
            throw new Error( 'Por favor, ingrese URLs válidas para analizar' );
        }

        if ( totalUrls > MAX_URLS ) {
            throw new Error( `Por favor, ingrese menos de ${MAX_URLS} URLs para procesar` );
        }

        toggleLoader( true, { processedUrls: 0, totalUrls, status: 'Preparando análisis...' } );

        const batches = splitIntoBatches( urls );
        let processedUrls = 0;
        const results = [];

        for ( let i = 0; i < batches.length && !isCancelled; i++ ) {
            const batch = batches[ i ];
            try {
                // Actualizar progreso antes de procesar
                const currentBatch = i + 1;
                updateStatusMessage( `Procesando lote ${currentBatch}/${batches.length}` );

                // Iniciar animación de progreso intermedio
                LoaderProgressSraping( processedUrls, totalUrls, i, batches.length );

                const batchResults = await processBatchWithRetry( batch );

                if ( isCancelled ) break;

                results.push( ...batchResults );
                processedUrls += batch.length;

                // Actualizar progreso real
                updateLoaderProgress( processedUrls, totalUrls );

                // Actualizar resultados incrementalmente
                displayResults( batchResults, true );

                if ( processedUrls % 50 === 0 ) {
                    await delay( 100 ); // Pequeña pausa para evitar bloqueo UI
                }
            } catch ( batchError ) {
                console.error( 'Error en batch:', batchError );
                showError( `Error al procesar lote ${i + 1}: ${batchError.message}` );
            }
        }

        if ( !isCancelled ) {
            updateLoaderProgress( totalUrls, totalUrls, '¡Análisis completado!' );
            await delay( 1000 );
            toggleLoader( false );
        }

    } catch ( error ) {
        console.error( 'Error principal:', error );
        showError( error.message );
        await delay( 1000 );
        toggleLoader( false );
    } finally {
        window.isProcessing = false;
        clearProgressAnimation();
    }
}

// Actualiza el progreso del scraping
function updateProgress( current, total ) {
    if ( !total ) return 0;
    const percentage = Math.floor( ( current / total ) * 100 );
    const steps = document.querySelectorAll( '.step' );
    steps.forEach( ( step, index ) => step.classList.toggle( 'active', percentage >= ( index + 1 ) * 33 ) );
    return percentage;
}

// Función de progreso de loader
function LoaderProgressSraping( current, total, batchIndex, batchesTotal ) {
    let progress = ( current / total ) * 100;
    const targetProgress = ( ( batchIndex + 1 ) / batchesTotal ) * 100;
    clearInterval( progressInterval );

    if ( batchIndex === 0 && current === 0 ) {
        progress = 0;
        updateLoaderProgress( 0, total, 'Iniciando proceso...' );
    }

    progressInterval = setInterval( () => {
        if ( progress < targetProgress ) {
            progress += STEP_INCREMENT;
            const currentCount = Math.floor( ( progress / 100 ) * total );

            updateLoaderProgress(
                currentCount,
                total,
                `Procesando URLs... ${Math.floor( progress )}%`
            );
        } else {
            clearInterval( progressInterval );
        }
    }, ANIMATION_INTERVAL );

    return progressInterval;
}

//Función para limpiar el intervalo cuando sea necesario
function clearProgressAnimation() {
    if ( progressInterval ) {
        clearInterval( progressInterval );
    }
}

// Muestra los resultados en la tabla.
function displayResults( results, isIncremental = false ) {
    if ( !elements[ 'result-body' ] ) return;

    const fadeOutDuration = 300;
    const fadeInDuration = 300;

    // Fade out actual contenido
    elements[ 'result-body' ].style.opacity = '0';
    elements[ 'result-body' ].style.transition = `opacity ${fadeOutDuration}ms ease-in-out`;

    setTimeout( () => {
        allResults = isIncremental ? [ ...allResults, ...results ] : results;
        updateResultsCounter();

        if ( !isIncremental ) selectedRows.clear();

        const totalPages = Math.ceil( allResults.length / itemsPerPage );
        const startIndex = ( currentPage - 1 ) * itemsPerPage;
        const endIndex = Math.min( startIndex + itemsPerPage, allResults.length );

        const fragment = document.createDocumentFragment();
        ensureHeaderCheckbox();

        allResults.slice( startIndex, endIndex ).forEach( result => {
            const row = createTableRow( result );
            fragment.appendChild( row );
        } );

        // Actualizar contenido y fade in
        elements[ 'result-body' ].innerHTML = '';
        elements[ 'result-body' ].appendChild( fragment );
        elements[ 'result-body' ].style.opacity = '1';

        updatePaginationControls( totalPages );
        updateSelectedCount();
        updateActionButtonsState();
    }, fadeOutDuration );
}

// Crea  fila para la tabla
function createTableRow( result ) {
    const row = document.createElement( 'tr' );
    row.dataset.url = result.url;
    row.style.height = '40px'; // Altura fija más pequeña

    row.appendChild( createCheckboxCell( result.url ) );

    const metaTags = [ 'title', 'description', 'canonical', 'h1', 'og:title', 'og:description', 'og:url' ];
    row.appendChild( createTableCell( result.url ) );
    metaTags.forEach( tag => {
        const cell = createTableCell( getMetaContent( result.metaTags, tag ) );
        cell.style.maxWidth = '200px';
        cell.style.overflow = 'hidden';
        cell.style.textOverflow = 'ellipsis';
        row.appendChild( cell );
    } );

    if ( result.status === 'error' ) {
        row.classList.add( 'bg-red-50' );
    }

    return row;
}

// Obtiene el contenido de meta tag.
function getMetaContent( tags, name ) {
    if ( !Array.isArray( tags ) ) return 'No encontrado';
    const tag = tags.find( tag => tag?.name === name );
    return tag?.content || 'No encontrado';
}

// Actualiza el contenido de la tabla.
function updateTableContent( fragment ) {
    elements[ 'result-body' ].innerHTML = '';
    elements[ 'result-body' ].appendChild( fragment );
    applyTableStyles();
}

// Función para asegurar que existe el checkbox
function ensureHeaderCheckbox() {
    const thead = document.querySelector( '#result-table thead tr' );
    if ( !thead ) return;

    let checkboxHeader = thead.querySelector( '.checkbox-column' );
    if ( checkboxHeader ) {
        checkboxHeader.innerHTML = '';
    } else {
        checkboxHeader = document.createElement( 'th' );
        checkboxHeader.className = 'checkbox-column px-4 py-2 border';
        thead.insertBefore( checkboxHeader, thead.firstChild );
    }

    const headerContent = document.createElement( 'div' );
    headerContent.className = 'flex items-center gap-2';
    const headerCheckbox = document.createElement( 'input' );
    headerCheckbox.type = 'checkbox';
    headerCheckbox.className = 'form-checkbox h-4 w-4 text-blue-600';
    headerCheckbox.addEventListener( 'change', handleHeaderCheckboxChange );
    const headerText = document.createElement( 'span' );
    headerText.textContent = 'Seleccionar';
    headerText.className = 'text-sm text-gray-600';
    headerContent.appendChild( headerCheckbox );
    headerContent.appendChild( headerText );
    checkboxHeader.appendChild( headerContent );
}

// Función para crear la celda del checkbox en cada fila
function createCheckboxCell( url ) {
    const cell = document.createElement( 'td' );
    cell.className = 'checkbox-column px-2 py-1 border';
    const checkbox = document.createElement( 'input' );
    checkbox.type = 'checkbox';
    checkbox.className = 'form-checkbox h-4 w-4 text-blue-600';
    checkbox.checked = selectedRows.has( url );
    checkbox.addEventListener( 'change', ( e ) => handleRowCheckboxChange( e, url ) );
    cell.appendChild( checkbox );
    return cell;
}

// Maneja el cambio del checkbox para seleccionar o deseleccionar toda la pagina 
function handleHeaderCheckboxChange( e ) {
    const isChecked = e.target.checked;
    const checkboxes = document.querySelectorAll( '#result-table tbody input[type="checkbox"]' );
    const visibleRows = document.querySelectorAll( '#result-table tbody tr' );

    visibleRows.forEach( row => {
        const url = row.dataset.url;
        const checkbox = row.querySelector( 'input[type="checkbox"]' );

        if ( checkbox ) {
            checkbox.checked = isChecked;
            if ( isChecked ) {
                selectedRows.add( url );
                row.classList.add( 'selected' );
            } else {
                selectedRows.delete( url );
                row.classList.remove( 'selected' );
            }
        }
    } );

    updateSelectedCount();
    updateActionButtonsState();
}

function handleRowCheckboxChange( e, url ) {
    const isChecked = e.target.checked;
    const row = e.target.closest( 'tr' );
    if ( isChecked ) {
        selectedRows.add( url );
        row.classList.add( 'selected' );
    } else {
        selectedRows.delete( url );
        row.classList.remove( 'selected' );
    }
    updateSelectAllState();
    updateActionButtonsState();
    updateSelectedCount(); // Add this line
}

// Maneja el cambio del checkbox por fila
function updateSelectAllState() {
    const headerCheckbox = document.querySelector( '#result-table thead input[type="checkbox"]' );
    const rowCheckboxes = Array.from( document.querySelectorAll( '#result-table tbody input[type="checkbox"]' ) );
    if ( !headerCheckbox || rowCheckboxes.length === 0 ) return;
    const allChecked = rowCheckboxes.every( checkbox => checkbox.checked );
    const someChecked = rowCheckboxes.some( checkbox => checkbox.checked );
    headerCheckbox.checked = allChecked;
    headerCheckbox.indeterminate = someChecked && !allChecked;
}

// Actualiza el estado del checkbox "Seleccionar todo"
function updateActionButtonsState() {
    const copyButton = document.querySelector( '.copy-button' );
    if ( copyButton ) {
        copyButton.disabled = selectedRows.size === 0;
        copyButton.classList.toggle( 'opacity-50', selectedRows.size === 0 );
    }
    const clearResultsButton = document.getElementById( 'clearResults' );
    if ( clearResultsButton ) {
        const hasSelectedRows = selectedRows.size > 0;
        clearResultsButton.textContent = hasSelectedRows ? 'Eliminar seleccionados 🗑️' : 'Limpiar resultados 🗑️';
    }
}

// Muestra un mensaje de "no hay resultados" en tabla
function showEmptyState() {
    const emptyState = document.createElement( 'tr' );
    emptyState.innerHTML = `<td colspan="9" class="text-center py-8 text-gray-500">No hay resultados para mostrar</td>`;
    elements[ 'result-body' ].appendChild( emptyState );
}

// Aplica clases para estilos a la tabla.
function applyTableStyles() {
    const table = elements[ 'result-table' ];
    if ( table ) {
        table.classList.add( 'min-w-full', 'border-collapse', 'bg-white', 'shadow-sm', 'rounded-lg', 'overflow-hidden' );
        const thead = table.querySelector( 'thead' );
        if ( thead ) {
            thead.classList.add( 'bg-gray-100' );
            thead.querySelectorAll( 'th' ).forEach( header => {
                header.classList.add( 'px-4', 'py-2', 'text-left', 'font-semibold', 'text-gray-700', 'border-b', 'border-gray-200' );
            } );
        }
    }
}

// Función modificada para crear celda de tabla
function createTableCell( content, isError = false ) {
    const cell = document.createElement( 'td' );
    cell.classList.add( 'px-2', 'py-1', 'border', 'relative', 'group' );

    // Estilos base para todas las celdas
    cell.style.maxWidth = '300px';
    cell.style.minWidth = '250px';
    cell.style.height = '40px';

    // Contenedor para el texto con tooltip
    const textContainer = document.createElement( 'div' );
    textContainer.className = 'truncate hover:whitespace-normal hover:overflow-visible hover:bg-white hover:shadow-lg hover:z-10 hover:absolute hover:p-2 hover:border hover:rounded';

    if ( content === 'No encontrado' ) {
        textContainer.classList.add( 'text-gray-400', 'italic' );
    } else if ( isError ) {
        textContainer.classList.add( 'text-red-500' );
    }

    if ( typeof content === 'string' && content.startsWith( 'http' ) ) {
        const cellContent = document.createElement( 'div' );
        cellContent.className = 'flex items-center justify-between gap-1';

        const link = document.createElement( 'a' );
        link.href = content;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = content;
        link.classList.add( 'text-blue-600', 'hover:underline', 'truncate' );

        cellContent.appendChild( link );
        textContainer.appendChild( cellContent );
    } else {
        textContainer.textContent = content;
    }

    cell.appendChild( textContainer );
    return cell;
}

// Función auxiliar para cambiar de página
function handlePageChange( page ) {
    if ( page < 1 || page > Math.ceil( allResults.length / itemsPerPage ) ) return;

    const oldPage = currentPage;
    currentPage = page;

    // Determinar dirección de la animación
    const direction = page > oldPage ? 1 : -1;

    // Aplicar animación de transición
    const tableBody = elements[ 'result-body' ];
    tableBody.style.transition = 'transform 0.3s ease-out, opacity 0.3s ease-out';
    tableBody.style.transform = `translateX(${direction * -20}px)`;
    tableBody.style.opacity = '0';

    setTimeout( () => {
        displayResults( allResults );
        tableBody.style.transform = `translateX(${direction * 20}px)`;

        requestAnimationFrame( () => {
            tableBody.style.transform = 'translateX(0)';
            tableBody.style.opacity = '1';
        } );
    }, 300 );
}

// Función para la exportación
async function copyTable() {
    try {
        if ( !window.XLSX ) throw new Error( 'La librería de Excel no está cargada' );

        const resultsToExport = selectedRows.size > 0
            ? allResults.filter( result => selectedRows.has( result.url ) )
            : allResults;

        if ( resultsToExport.length === 0 ) {
            throw new Error( 'No hay datos para exportar' );
        }

        const exportData = resultsToExport.map( result => ( {
            'URL': result.url,
            'Title': getMetaContent( result.metaTags, 'title' ),
            'Description': getMetaContent( result.metaTags, 'description' ),
            'Canonical': getMetaContent( result.metaTags, 'canonical' ),
            'H1': getMetaContent( result.metaTags, 'h1' ),
            'OG:Title': getMetaContent( result.metaTags, 'og:title' ),
            'OG:Description': getMetaContent( result.metaTags, 'og:description' ),
            'OG:URL': getMetaContent( result.metaTags, 'og:url' )
        } ) );

        const ws = XLSX.utils.json_to_sheet( exportData );
        const wb = XLSX.utils.book_new();

        // Configurar anchos de columna
        const colWidths = [
            { wch: 40 }, // URL
            { wch: 30 }, // Title
            { wch: 50 }, // Description
            { wch: 40 }, // Canonical
            { wch: 30 }, // H1
            { wch: 30 }, // OG:Title
            { wch: 50 }, // OG:Description
            { wch: 40 }  // OG:URL
        ];
        ws[ '!cols' ] = colWidths;

        XLSX.utils.book_append_sheet( wb, ws, 'Meta Tags' );
        const date = new Date().toISOString().split( 'T' )[ 0 ];
        const fileName = `meta_tags_analysis_${date}.xlsx`;
        XLSX.writeFile( wb, fileName );
        showNotification( 'Archivo exportado exitosamente', 'success' );
    } catch ( error ) {
        console.error( 'Error al exportar:', error );
        showNotification( error.message, 'error' );
    }
}

// Función para mostrar numero de página a mostrar
function getPageNumbersToShow( currentPage, totalPages ) {
    let pages = [];

    if ( totalPages <= 7 ) {
        for ( let i = 1; i <= totalPages; i++ ) {
            pages.push( i );
        }
    } else {
        // Siempre mostrar primera página
        pages.push( 1 );

        if ( currentPage <= 3 ) {
            pages.push( 2, 3, 4, '...', totalPages );
        } else if ( currentPage >= totalPages - 2 ) {
            pages.push( '...', totalPages - 3, totalPages - 2, totalPages - 1, totalPages );
        } else {
            pages.push( '...', currentPage - 1, currentPage, currentPage + 1, '...', totalPages );
        }
    }

    return pages;
}

// Actualiza los controles de paginación.
function updatePaginationControls( totalPages ) {
    const paginationContainer = document.querySelector( '.pagination-controls' );
    if ( !paginationContainer ) return;

    // Si no hay resultados, ocultar la paginación
    if ( allResults.length === 0 ) {
        paginationContainer.style.display = 'none';
        return;
    }

    paginationContainer.style.display = 'flex';
    paginationContainer.innerHTML = '';

    // Contenedor para los controles de paginación
    const controlsWrapper = document.createElement( 'div' );
    controlsWrapper.className = 'flex items-center gap-2 bg-white rounded-lg shadow-sm p-2';

    // Información de página actual
    const pageInfo = document.createElement( 'span' );
    pageInfo.className = 'text-sm text-gray-600 mx-4';
    pageInfo.textContent = `Página ${currentPage} de ${totalPages}`;

    // Botones de navegación
    const prevButton = createNavigationButton( ' < ', currentPage > 1, () => handlePageChange( currentPage - 1 ) );
    const nextButton = createNavigationButton( ' > ', currentPage < totalPages, () => handlePageChange( currentPage + 1 ) );

    // Agregar todo al contenedor
    controlsWrapper.appendChild( prevButton );
    controlsWrapper.appendChild( pageInfo );
    controlsWrapper.appendChild( nextButton );
    paginationContainer.appendChild( controlsWrapper );
}

// Crea botónes de navegación (anterior/siguiente)
function createNavigationButton( text, enabled, onClick ) {
    const button = document.createElement( 'button' );
    button.className = `px-4 py-2 rounded-md transition-colors duration-200 ${enabled
        ? 'bg-blue-600 text-white hover:bg-blue-700'
        : 'bg-gray-200 text-gray-400 cursor-not-allowed'
        }`;
    button.textContent = text;
    button.disabled = !enabled;
    if ( enabled ) {
        button.onclick = onClick;
    }
    return button;
}

// Crea botónes de paginación (número de página)
function createPaginationButton( text, enabled, onClick ) {
    const button = document.createElement( 'button' );
    button.className = `flex items-center px-3 py-2 rounded-md transition-colors duration-200 ${enabled
        ? 'text-gray-600 hover:bg-gray-100'
        : 'text-gray-300 cursor-not-allowed'
        }`;
    button.disabled = !enabled;
    if ( enabled ) {
        button.onclick = onClick;
    }
    return button;
}

// Carga la librería SheetJS para la exportación
function loadSheetJS() {
    return new Promise( ( resolve, reject ) => {
        if ( window.XLSX ) {
            resolve( window.XLSX );
            return;
        }

        const script = document.createElement( 'script' );
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
        script.integrity = 'sha512-r22gChDnGvBylk90+2e/ycr3RVrDi8DIOkIGNhJlKfuyQM4tIRAI062MaV8sfjQKYVGjOBaZBOA87z+IhZE9DA==';
        script.crossOrigin = 'anonymous';
        script.referrerPolicy = 'no-referrer';

        script.onload = () => resolve( window.XLSX );
        script.onerror = ( e ) => {
            const error = new Error( 'Error al cargar SheetJS' );
            error.event = e;
            reject( error );
            showNotification( 'Error al cargar el módulo de exportación. Intente recargar la página.', 'error' );
        };

        document.head.appendChild( script );
    } );
}

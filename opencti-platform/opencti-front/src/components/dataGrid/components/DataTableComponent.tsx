import React, { useEffect, useMemo, useState } from 'react';
import * as R from 'ramda';
import { DataTableLinesDummy } from './DataTableLine';
import DataTableBody from './DataTableBody';
import { DataTableContext, defaultColumnsMap } from '../dataTableUtils';
import { DataTableColumn, DataTableColumns, DataTableContextProps, DataTableProps, DataTableVariant, LocalStorageColumns } from '../dataTableTypes';
import DataTableHeaders from './DataTableHeaders';

const DataTableComponent = ({
  dataColumns,
  resolvePath,
  storageKey,
  initialValues,
  availableFilterKeys,
  toolbarFilters,
  dataQueryArgs,
  redirectionModeEnabled = false,
  useLineData,
  useDataTable,
  useDataCellHelpers,
  useDataTableToggle,
  useComputeLink,
  useDataTableLocalStorage,
  formatter,
  settingsMessagesBannerHeight,
  storageHelpers,
  filtersComponent,
  redirectionMode,
  numberOfElements,
  onAddFilter,
  onSort,
  sortBy,
  orderAsc,
  dataTableToolBarComponent,
  variant = DataTableVariant.default,
  rootRef,
  actions,
  createButton,
  pageSize,
  disableNavigation,
  disableLineSelection,
  disableToolBar,
  disableSelectAll,
  selectOnLineClick,
  onLineClick,
}: DataTableProps) => {
  const localStorageColumns = useDataTableLocalStorage<LocalStorageColumns>(`${storageKey}_columns`, {}, true)[0];
  const toggleHelper = useDataTableToggle(storageKey);

  const columnsInitialState = [
    ...((toggleHelper.onToggleEntity && !disableLineSelection) ? [{ id: 'select', visible: true } as DataTableColumn] : []),
    ...Object.entries(dataColumns).map(([key, column], index) => {
      const currentColumn = localStorageColumns?.[key];
      return R.mergeDeepRight(defaultColumnsMap.get(key) as DataTableColumn, {
        ...column,
        order: currentColumn?.index ?? index,
        visible: currentColumn?.visible ?? true,
      });
    }),
    // inject "navigate" action (chevron) if navigable and no specific actions defined
    ...((disableNavigation || actions) ? [] : [{ id: 'navigate', visible: true } as DataTableColumn]),
  ];

  const [columns, setColumns] = useState<DataTableColumns>(columnsInitialState);

  // QUERY PART
  const [page, setPage] = useState<number>(1);
  const defaultPageSize = variant === DataTableVariant.default ? 25 : Number.MAX_SAFE_INTEGER;
  const currentPageSize = pageSize ? Number.parseInt(pageSize, 10) : defaultPageSize;
  const pageStart = useMemo(() => {
    return page ? (page - 1) * currentPageSize : 0;
  }, [page, currentPageSize]);

  return (
    <DataTableContext.Provider
      value={{
        storageKey,
        columns,
        availableFilterKeys,
        effectiveColumns: columns.filter(({ visible }) => visible).sort((a, b) => a.order - b.order),
        initialValues,
        setColumns,
        resetColumns: () => setColumns(columnsInitialState),
        resolvePath,
        redirectionModeEnabled,
        toolbarFilters,
        useLineData,
        useDataTable,
        useDataCellHelpers,
        useDataTableToggle,
        useComputeLink,
        useDataTableLocalStorage,
        onAddFilter,
        onSort,
        formatter,
        variant,
        rootRef,
        actions,
        createButton,
        disableNavigation,
        disableToolBar,
        disableSelectAll,
        selectOnLineClick,
        onLineClick,
        page,
        setPage,
      } as DataTableContextProps}
    >
      <div>
        {filtersComponent ?? (variant === DataTableVariant.inline && (
          <div
            style={{
              width: '100%',
              textAlign: 'right',
              marginBottom: 10,
            }}
          >
            <strong>{`${numberOfElements?.number}${numberOfElements?.symbol}`}</strong>{' '}
            {formatter.t_i18n('entitie(s)')}
          </div>
        ))}
      </div>
      <React.Suspense
        fallback={(
          <div style={{ width: '100%' }}>
            <DataTableHeaders
              effectiveColumns={columns}
              sortBy={sortBy}
              orderAsc={orderAsc}
              dataTableToolBarComponent={dataTableToolBarComponent}
            />
            {<DataTableLinesDummy number={Math.max(currentPageSize, 100)} />}
          </div>
          )}
      >
        <DataTableBody
          dataQueryArgs={dataQueryArgs}
          columns={columns.filter(({ visible }) => visible)}
          redirectionMode={redirectionMode}
          storageHelpers={storageHelpers}
          settingsMessagesBannerHeight={settingsMessagesBannerHeight}
          hasFilterComponent={!!filtersComponent}
          sortBy={sortBy}
          orderAsc={orderAsc}
          dataTableToolBarComponent={dataTableToolBarComponent}
          pageStart={pageStart}
          pageSize={currentPageSize}
        />
      </React.Suspense>
    </DataTableContext.Provider>
  );
};

export default DataTableComponent;
